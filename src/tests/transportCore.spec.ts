import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function start(){
  return spawn('node',[path.join(__dirname,'../../dist/server/transport.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
}

describe('transport core', () => {
  it('initializes and returns error for unknown method', async () => {
    const proc = start();
    const out: string[] = []; proc.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,50));
    // send initialize
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18' } })+'\n');
    await new Promise(r=> setTimeout(r,40));
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'does/notExist', params:{} })+'\n');
    const startAt = Date.now();
    let gotInit=false, gotErr=false;
    while(Date.now()-startAt < 1200 && (!gotInit || !gotErr)){
      const lines = out.slice();
      for(const l of lines){
        try { const o = JSON.parse(l); if(o.id===1 && o.result) gotInit=true; if(o.id===2 && o.error) gotErr=true; } catch { /* ignore */ }
      }
      if(gotInit && gotErr) break;
      await new Promise(r=> setTimeout(r,25));
    }
    expect(gotInit).toBe(true);
    expect(gotErr).toBe(true);
    proc.kill();
  }, 4000);
});
