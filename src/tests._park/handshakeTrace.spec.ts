import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_HANDSHAKE_TRACE:'1' } });
}

interface JsonRpc {
  jsonrpc:'2.0'; id?: number|string|null; method:string; params?: Record<string,unknown>;
}
function send(p: ReturnType<typeof startServer>, obj: JsonRpc){ p.stdin.write(JSON.stringify(obj)+'\n'); }

function collect(stream: NodeJS.ReadableStream, sink: string[]){
  let buf='';
  stream.on('data', d=>{ buf+=d.toString(); const parts=buf.split(/\n/); buf=parts.pop()!; for(const p of parts){ const line=p.trim(); if(line) sink.push(line); } });
}

describe('Handshake trace ordering', () => {
  it('emits initialize response before ready and only one ready', async () => {
    const proc = startServer();
    const out: string[] = []; const err: string[] = [];
    collect(proc.stdout, out); collect(proc.stderr, err);
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'trace-test', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> /"id":1/.test(l)), 4000);
    // Wait briefly for potential ready(s)
    await new Promise(r=> setTimeout(r,150));
    proc.kill();
    const initIndex = out.findIndex(l=> /"id":1/.test(l));
    const readyIndices = out.map((l,i)=> l.includes('"method":"server/ready"') ? i : -1).filter(i=> i>=0);
    expect(initIndex).toBeGreaterThanOrEqual(0);
    expect(readyIndices.length).toBeGreaterThanOrEqual(1);
    // All ready notifications must come AFTER initialize response to satisfy ordering
    expect(readyIndices.every(i=> i > initIndex)).toBe(true);
    // At most one ready (primary path) – if more appear it's a regression in dedup logic
    expect(readyIndices.length).toBe(1);
    // stderr handshake trace should contain initialize_received and ready_emitted
    const traceInit = err.some(l=> l.includes('initialize_received'));
    const traceReady = err.some(l=> l.includes('ready_emitted'));
    expect(traceInit).toBe(true);
    expect(traceReady).toBe(true);
  }, 6000);
});
