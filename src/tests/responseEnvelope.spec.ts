import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function start(flag: boolean){
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_FLAG_RESPONSE_ENVELOPE_V1: flag? '1':'0' }});
}

function send(p: ReturnType<typeof start>, msg: Record<string,unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }

function collect(out: string[], id: number){ return out.filter(l=> { try { const o=JSON.parse(l); return o.id===id; } catch { return false; } }).pop(); }

describe('response envelope flag', () => {
  it('returns legacy shape when flag disabled', async () => {
    const proc = start(false);
    const out: string[]=[]; proc.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,80));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }});
    await new Promise(r=> setTimeout(r,50));
    send(proc,{ jsonrpc:'2.0', id:2, method:'health/check', params:{} });
    // wait for id:2
    const startAt = Date.now();
    while(Date.now()-startAt < 1500 && !collect(out,2)){ await new Promise(r=> setTimeout(r,20)); }
    const respLine = collect(out,2);
    expect(respLine).toBeTruthy();
    const obj = JSON.parse(respLine!);
    expect(obj.result).toBeTruthy();
    expect(obj.result.version).toBeTruthy(); // direct properties (no envelope)
    proc.kill();
  }, 4000);

  it('wraps response when flag enabled', async () => {
    const proc = start(true);
    const out: string[]=[]; proc.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,80));
    send(proc,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }});
    await new Promise(r=> setTimeout(r,50));
    send(proc,{ jsonrpc:'2.0', id:11, method:'health/check', params:{} });
    const startAt = Date.now();
    while(Date.now()-startAt < 1500 && !collect(out,11)){ await new Promise(r=> setTimeout(r,20)); }
    const respLine = collect(out,11);
    expect(respLine).toBeTruthy();
    const obj = JSON.parse(respLine!);
    expect(obj.result).toBeTruthy();
    // Envelope present
    expect(obj.result.version).toBe(1); // envelope version
    expect(obj.result.serverVersion).toBeTruthy();
    expect(obj.result.data).toBeTruthy();
    expect(obj.result.data.version).toBeTruthy();
    proc.kill();
  }, 4000);
});
