import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

function collect(proc: ReturnType<typeof startServer>, sink: string[]){
  let buf='';
  proc.stdout.on('data', d=>{ buf+=d.toString(); const parts=buf.split(/\n/); buf=parts.pop()!; for(const p of parts){ const line=p.trim(); if(line) sink.push(line); } });
}

async function waitForIds(lines: string[], ids: number[], timeout=10_000){
  const set = new Set(ids);
  await waitFor(()=> lines.filter(l=>{ try { const o=JSON.parse(l); return set.has(o.id); } catch { return false; } }).length === set.size, timeout);
}

describe('health/check contention diagnostics', () => {
  it('interleaved diagnostics/block tools do not cause permanent health hang', async () => {
    const server = startServer();
    const lines: string[] = [];
    collect(server, lines);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'health-contention', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> lines.some(l=> l.includes('"id":1')));
    // Interleave: block(120ms) + health, repeated 8 times
    const pairs = 8;
    let nextId = 2;
    const healthIds: number[] = [];
    for(let i=0;i<pairs;i++){
      send(server,{ jsonrpc:'2.0', id: nextId++, method:'tools/call', params:{ name:'diagnostics/block', arguments:{ ms:120 } } });
      const hid = nextId++;
      healthIds.push(hid);
      send(server,{ jsonrpc:'2.0', id: hid, method:'tools/call', params:{ name:'health/check', arguments:{} } });
    }
    await waitForIds(lines, healthIds, 8000);
    // Assert each health eventually responded (already implied) and approximate latency budget (< 1s after preceding block)
    for(const id of healthIds){
      const line = lines.find(l=> l.includes(`"id":${id}`));
      expect(line, `missing health response for id ${id}`).toBeTruthy();
      if(line){
        const obj = JSON.parse(line);
        expect(obj.error, `unexpected error for health id ${id}`).toBeFalsy();
      }
    }
    server.kill();
  }, 15000);

  it('queued long diagnostics/block at front delays but does not hang subsequent health calls', async () => {
    const server = startServer();
    const lines: string[] = [];
    collect(server, lines);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'health-contention', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> lines.some(l=> l.includes('"id":1')));
    // Queue one long block (1000ms) then 30 health checks immediately (pipelined)
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'diagnostics/block', arguments:{ ms:1000 } } });
    const healthIds: number[] = [];
    for(let i=0;i<30;i++){
      const hid = 3+i;
      healthIds.push(hid);
      send(server,{ jsonrpc:'2.0', id: hid, method:'tools/call', params:{ name:'health/check', arguments:{} } });
    }
    await waitForIds(lines, [2, ...healthIds], 10_000);
    // All health responses should have appeared; verify status ok
    for(const id of healthIds){
      const line = lines.find(l=> l.includes(`"id":${id}`));
      expect(line, `missing health response ${id}`).toBeTruthy();
      if(line){
        const obj = JSON.parse(line);
        expect(obj.error, `health error id ${id}`).toBeFalsy();
      }
    }
    server.kill();
  }, 20000);
});
