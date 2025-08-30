import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForDist } from './distReady';
import { getResponse } from './testUtils';

interface JsonRpcEnvelope {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  [k: string]: unknown;
  __rt?: number; // latency ms
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

async function timedRequest(lines: string[], id: number, timeoutMs: number, sentAt: number): Promise<JsonRpcEnvelope>{
  const env = await getResponse(lines, id, timeoutMs) as JsonRpcEnvelope;
  env.__rt = Date.now() - sentAt;
  return env;
}

// Minimal status extractor (tools/call health/check success path)
interface ToolCallResultShape { content?: Array<{ text?: string }> ; status?: unknown; data?: { status?: unknown }; }
function extractStatus(result: unknown): string | undefined {
  if(!result || typeof result !== 'object') return undefined;
  const r = result as ToolCallResultShape;
  const content = Array.isArray(r.content) ? r.content[0]?.text : undefined;
  if(typeof content === 'string'){
    const trimmed = content.trim();
    if(trimmed === 'ok') return 'ok';
    if(/^[{[]/.test(trimmed)){
      try {
        const parsed = JSON.parse(trimmed) as ToolCallResultShape;
        if(parsed){
          if(typeof parsed.status === 'string') return String(parsed.status);
          if(parsed.data && typeof parsed.data === 'object' && typeof parsed.data.status === 'string') return String(parsed.data.status);
        }
      } catch { /* ignore parse errors */ }
    }
  }
  if(typeof r.status === 'string') return String(r.status);
  return undefined;
}

describe('health/check parallel burst hang detection', () => {
  it('25 parallel tools/call health/check requests all respond <1.5s', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);

    // initialize
    send(server,{ jsonrpc:'2.0', id:900, method:'initialize', params:{ protocolVersion:'2025-06-18' } });
    await timedRequest(lines,900,3000, Date.now());

    const parallel = 25;
    const startId = 1000;
    const sentAt: Record<number, number> = {};

    for(let i=0;i<parallel;i++){
      const id = startId + i;
      sentAt[id] = Date.now();
      send(server,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'health/check', arguments:{} } });
    }

    const responses = await Promise.all(
      Array.from({ length: parallel }, (_,i)=> timedRequest(lines, startId+i, 3000, sentAt[startId+i]))
    );

    // Assertions
    for(const env of responses){
      if(env.error){
        throw new Error(`Unexpected error for id ${env.id}: ${env.error.code} ${env.error.message}`);
      }
      const status = extractStatus(env.result);
      if(status !== 'ok'){
        throw new Error(`Non-ok status for id ${env.id}: ${JSON.stringify(env)}`);
      }
      expect(env.__rt).toBeLessThan(1500);
    }

    server.kill();
  }, 15000);

  it('two waves of parallel health/check bursts remain stable', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);

    send(server,{ jsonrpc:'2.0', id:910, method:'initialize', params:{ protocolVersion:'2025-06-18' } });
    await timedRequest(lines,910,3000, Date.now());

    async function wave(baseId: number){
      const parallel = 15;
      const sentAt: Record<number, number> = {};
      for(let i=0;i<parallel;i++){
        const id = baseId + i;
        sentAt[id] = Date.now();
        send(server,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'health/check', arguments:{} } });
      }
      const responses = await Promise.all(
        Array.from({ length: parallel }, (_,i)=> timedRequest(lines, baseId+i, 3000, sentAt[baseId+i]))
      );
      for(const env of responses){
        if(env.error){
          throw new Error(`Unexpected error for id ${env.id}: ${env.error.code} ${env.error.message}`);
        }
        const status = extractStatus(env.result);
        if(status !== 'ok'){
          throw new Error(`Non-ok status for id ${env.id}: ${JSON.stringify(env)}`);
        }
        expect(env.__rt).toBeLessThan(1500);
      }
    }

    await wave(2000);
    await wave(3000);

    server.kill();
  }, 20000);
});
