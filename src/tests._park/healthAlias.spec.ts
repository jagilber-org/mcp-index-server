import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForServerReady, getResponse } from './testUtils';
import { waitForDist } from './distReady';

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: '1' }
  });
}

// Line collector (shared minimal pattern)
function collectLines(stream: NodeJS.ReadableStream, sink: string[]){
  let buf='';
  stream.on('data', d=> {
    buf += d.toString();
    const parts = buf.split(/\n/);
    buf = parts.pop()!;
    for(const raw of parts){ const line = raw.trim(); if(line) sink.push(line); }
  });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

// High ID band 5600+ reserved for alias / deprecation tests
describe('health_check alias removed', () => {
  it('tools/call alias health_check returns unknown tool error', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collectLines(server.stdout, lines);
    // Standard readiness handshake (initialize + meta/tools)
    await waitForServerReady(server, lines, { initId: 5601, metaId: 5602 });
    // Invoke legacy alias via tools/call
    send(server,{ jsonrpc:'2.0', id:5603, method:'tools/call', params:{ name:'health_check', arguments:{} } });
    const env = await getResponse(lines,5603,3000);
    expect(env.error, 'expected error for obsolete alias').toBeTruthy();
    expect(env.error?.code).toBe(-32601); // Method/tool not found
    expect(String(env.error?.message||'')).toMatch(/Unknown tool/i);
    server.kill();
  }, 8000);

  it('direct JSON-RPC health_check method returns method not found', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collectLines(server.stdout, lines);
    await waitForServerReady(server, lines, { initId: 5610, metaId: 5611 });
    send(server,{ jsonrpc:'2.0', id:5612, method:'health_check', params:{} });
    const env = await getResponse(lines,5612,3000);
    expect(env.error, 'expected method not found error').toBeTruthy();
    expect(env.error?.code).toBe(-32601);
    server.kill();
  }, 8000);
});
