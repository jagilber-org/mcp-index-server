import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: '1' }
  });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

// Collect stdout lines robustly (handles partial chunks)
function collect(proc: ReturnType<typeof startServer>, sink: string[]){
  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    const parts = buf.split(/\n/);
    buf = parts.pop()!;
    for(const p of parts){ const line = p.trim(); if(line) sink.push(line); }
  });
}

async function waitForId(lines: string[], id: number, timeout=3000){
  await waitFor(()=> lines.some(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } }), timeout);
  return lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } });
}

describe('health_check alias removed', () => {
  it('tools/call alias health_check returns unknown tool error', async () => {
    const server = startServer();
    const lines: string[] = [];
    collect(server, lines);
    // initialize
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitForId(lines,1);
    // call via tools/call using alias (not in tools/list) - should return quickly
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'health_check', arguments:{} } });
    const respLine = await waitForId(lines,2,2000);
  expect(respLine, 'missing tools/call response for alias health_check').toBeTruthy();
    if(respLine){
      const obj = JSON.parse(respLine);
  expect(obj.error).toBeTruthy();
  expect(obj.error.code).toBe(-32601);
  expect(String(obj.error.message||'')).toMatch(/Unknown tool/i);
    }
    server.kill();
  }, 6000);

  it('direct JSON-RPC health_check method returns method not found', async () => {
    const server = startServer();
    const lines: string[] = [];
    collect(server, lines);
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitForId(lines,10);
    send(server,{ jsonrpc:'2.0', id:11, method:'health_check', params:{} });
    const respLine = await waitForId(lines,11,2000);
  expect(respLine, 'missing direct response for health_check').toBeTruthy();
    if(respLine){
      const obj = JSON.parse(respLine);
  expect(obj.error).toBeTruthy();
  expect(obj.error.code).toBe(-32601);
    }
    server.kill();
  }, 6000);
});
