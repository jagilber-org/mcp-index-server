import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForDist } from './distReady';
import { getResponse } from './testUtils';

interface JsonRpcEnvelope {
  id?: number;
  result?: unknown; // result envelope varies by handler
  error?: { code: number; message: string; data?: unknown };
  [k: string]: unknown;
  __rt?: number; // added latency measurement
}

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env }
  });
}

function collect(stream: NodeJS.ReadableStream, sink: string[]){
  let buf='';
  stream.on('data', d=> {
    buf += d.toString();
    const parts = buf.split(/\n/);
    buf = parts.pop()!;
    for(const raw of parts){ const line = raw.trim(); if(line) sink.push(line); }
  });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

async function timedRequest(lines: string[], id: number, timeoutMs: number): Promise<JsonRpcEnvelope>{
  const start = Date.now();
  const env = await getResponse(lines, id, timeoutMs) as JsonRpcEnvelope;
  env.__rt = Date.now() - start;
  return env;
}

interface PossiblyStatus { status?: unknown; content?: Array<{ text?: string }>; }
interface EnvelopeV1<T=unknown>{ version: number; serverVersion?: string; data: T }
function hasStatus(obj: unknown): obj is PossiblyStatus {
  return !!obj && typeof obj === 'object' && ('status' in obj || 'content' in obj);
}
function extractStatus(result: unknown): string | undefined {
  // Direct unwrapped shape { status:'ok', ... }
  if(hasStatus(result) && typeof result.status === 'string') return String(result.status);
  // New response_envelope_v1 shape: { version:1, serverVersion:'x', data:{ status:'ok' } }
  if(result && typeof result === 'object' && 'version' in result && 'data' in result){
    const env = result as EnvelopeV1<unknown>;
    const data = env.data as PossiblyStatus | undefined;
    if(data && typeof data === 'object' && 'status' in data && typeof data.status === 'string') return String(data.status);
    // Fallback: nested content path
    if(data && typeof data === 'object' && 'content' in data){
      const nested = extractStatus(data as unknown); if(nested) return nested;
    }
  }
  // tools/call legacy meta/tools style embedding: result.content[0].text holds JSON string (or plain 'ok')
  if(hasStatus(result)){
    const contentArr = result.content;
    if(Array.isArray(contentArr) && contentArr[0]?.text){
      const rawText = contentArr[0].text || '';
      if(rawText.trim() === 'ok') return 'ok'; // plain text fast-path
      try {
        const parsed = JSON.parse(rawText || '{}');
        if(parsed && typeof parsed === 'object'){
          if('status' in parsed && typeof (parsed as Record<string, unknown>).status === 'string') return String((parsed as Record<string, unknown>).status);
          // Envelope pattern
          if('version' in parsed && 'data' in parsed){
            const env = parsed as { version: unknown; data?: unknown };
            const data = env.data as Record<string, unknown> | undefined;
            if(typeof env.version === 'number' && data && typeof data.status === 'string') return data.status as string;
          }
          const deep = deepFindStatus(parsed, 0); if(deep) return deep;
        }
      } catch { /* ignore parse */ }
    }
  }
  // Exhaustive deep scan (defensive)
  if(result && typeof result === 'object'){
    const deep = deepFindStatus(result, 0); if(deep) return deep;
  }
  return undefined;
}

function deepFindStatus(obj: unknown, depth: number): string | undefined {
  if(depth > 5 || !obj || typeof obj !== 'object') return undefined;
  if('status' in (obj as Record<string, unknown>)){
    const v = (obj as Record<string, unknown>).status; if(typeof v === 'string') return v;
  }
  for(const val of Object.values(obj as Record<string, unknown>)){
    if(typeof val === 'object'){
      const found = deepFindStatus(val, depth+1); if(found) return found;
    } else if(typeof val === 'string'){
      if(val === 'ok') return 'ok';
  if(/^[{[]/.test(val.trim())){
        try { const parsed = JSON.parse(val); const inner = deepFindStatus(parsed, depth+1); if(inner) return inner; } catch { /* ignore */ }
      }
    }
  }
  return undefined;
}

describe('health/check hang reproduction attempts', () => {
  it('initialize -> tools/call health/check responds <1.5s', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18' } });
    await timedRequest(lines,1,3000);
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'health/check', arguments:{} } });
    const env = await timedRequest(lines,2,3000);
  expect(extractStatus(env.result)).toBe('ok');
    expect(env.__rt).toBeLessThan(1500);
    server.kill();
  }, 8000);

  it('direct method health/check (bypassing tools/call) returns method not found fast (legacy direct handlers removed)', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
  send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{} });
  await timedRequest(lines,10,3000);
  send(server,{ jsonrpc:'2.0', id:11, method:'health/check', params:{} });
  const env = await timedRequest(lines,11,3000);
  // Direct JSON-RPC method for health/check was removed (tools/call only); expect method not found (-32601)
  if(env.result !== undefined || env.error?.code !== -32601){
    // eslint-disable-next-line no-console
    console.error('[healthSim][direct][diag] unexpected legacy direct response', JSON.stringify(env));
  }
  expect(env.result).toBeUndefined();
  expect(env.error?.code).toBe(-32601);
  expect(env.__rt).toBeLessThan(1500);
    server.kill();
  }, 8000);

  it('legacy alias health_check via tools/call returns method not found fast', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    send(server,{ jsonrpc:'2.0', id:20, method:'initialize', params:{} });
    await timedRequest(lines,20,3000);
    send(server,{ jsonrpc:'2.0', id:21, method:'tools/call', params:{ name:'health_check', arguments:{} } });
    const env = await timedRequest(lines,21,3000);
    expect(env.error?.code).toBe(-32601);
    expect(env.__rt).toBeLessThan(1500);
    server.kill();
  }, 8000);

  it('pre-initialize call to health/check (raw) returns method not found after initialize (legacy direct path)', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    // Intentionally send health/check BEFORE initialize
    send(server,{ jsonrpc:'2.0', id:30, method:'health/check', params:{} });
    // Now initialize
    send(server,{ jsonrpc:'2.0', id:31, method:'initialize', params:{ protocolVersion:'2025-06-18' } });
    await timedRequest(lines,31,3000); // ensure initialize completes
  const env = await timedRequest(lines,30,3000); // prior request should now be answered
  // Expect method not found, matching removed direct handler behavior
  if(env.result !== undefined || env.error?.code !== -32601){
    // eslint-disable-next-line no-console
    console.error('[healthSim][pre-init][diag] unexpected pre-init legacy direct response', JSON.stringify(env));
  }
  expect(env.result).toBeUndefined();
  expect(env.error?.code).toBe(-32601);
    server.kill();
  }, 10000);

  it('stress 50 sequential tools/call health/check (<1.5s each)', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    send(server,{ jsonrpc:'2.0', id:40, method:'initialize', params:{} });
    await timedRequest(lines,40,3000);
    for(let i=0;i<50;i++){
      const id = 41+i;
      send(server,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'health/check', arguments:{} } });
      const env = await timedRequest(lines,id,3000);
  const status = extractStatus(env.result);
      if(status !== 'ok') throw new Error(`Unexpected status for id ${id}: ${JSON.stringify(env)}`);
      expect(env.__rt).toBeLessThan(1500);
    }
    server.kill();
  }, 20000);
});
