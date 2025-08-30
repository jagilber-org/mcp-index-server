import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function start(){
  // Use unified SDK server entrypoint (index.js) instead of legacy transport.js which is deprecated.
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
}

// Utility: wait until predicate true or timeout
async function waitFor(cond: ()=>boolean, timeout=1500, interval=25){
  const start=Date.now();
  while(Date.now()-start < timeout){
    if(cond()) return true;
    await new Promise(r=> setTimeout(r,interval));
  }
  return false;
}

describe('transport core', () => {
  it('initializes via unified server and returns error for unknown method', async () => {
    const proc = start();
    const out: string[] = [];
    const err: string[] = [];
    proc.stdout.on('data', d=> out.push(...d.toString().split(/\n+/).filter(Boolean)));
    proc.stderr.on('data', d=> err.push(...d.toString().split(/\n+/).filter(Boolean)));
    // Give the process a short settle then send initialize regardless of server/ready visibility (some runs may emit ready before listener attaches).
    await new Promise(r=> setTimeout(r,70));
  // Provide required clientInfo + capabilities fields (SDK requires these – earlier minimal shape triggered validation error)
  proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'transport-core-test', version:'0' }, capabilities:{ tools:{} } } })+'\n');
    const initOk = await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===1 && !!o.result; } catch { return false; } }), 3000, 30);
    if(!initOk){
      // Emit diagnostics to assist debugging flake
      // (Vitest will show this in failure output)
      // eslint-disable-next-line no-console
      console.error('transportCore diagnostics: init not observed. stdoutLines=', out.slice(0,20), 'stderrLines=', err.slice(0,20));
    }
    expect(initOk).toBe(true);
    // Only after initialize acknowledged, send unknown method to assert -32601 (method not found)
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'does/notExist', params:{} })+'\n');
    const errOk = await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===2 && !!o.error; } catch { return false; } }), 2500, 30);
    if(!errOk){
      console.error('transportCore diagnostics: error frame not observed. stdoutLines=', out.slice(0,30));
    }
    expect(errOk).toBe(true);
    proc.kill();
  }, 7000);
});
