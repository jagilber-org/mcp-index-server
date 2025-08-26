import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

function start(env: Record<string,string>){
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, ...env } });
}

interface RpcLine { id?: number; result?: unknown; error?: unknown }
// wait until predicate over parsed JSON stdout lines matches or timeout
function isPlainObject(v: unknown): v is Record<string, unknown>{
  return typeof v === 'object' && v !== null;
}
function waitFor(out: string[], pred: (o:RpcLine)=>boolean, timeout=2000){
  const start = Date.now();
  return new Promise<boolean>(resolve => {
    const tick = () => {
      for(const l of out){
        try { const raw = JSON.parse(l) as unknown; const o: RpcLine = isPlainObject(raw) ? { id: raw.id as number|undefined, result: (raw as Record<string, unknown>).result, error: (raw as Record<string, unknown>).error } : {}; if(pred(o)) return resolve(true); } catch { /* ignore */ }
      }
      if(Date.now()-start > timeout) return resolve(false);
      setTimeout(tick,40);
    }; tick();
  });
}

describe('mutation paths', () => {
  it('exercises add/remove/groom with mutation enabled', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'mut-')); // isolated instructions dir
    const proc = start({ MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: tmp });
    const out: string[] = []; proc.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,80));
    // initialize
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18' } })+'\n');
    await new Promise(r=> setTimeout(r,60));
    // add
  proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'instructions/add', params:{ entry:{ id:'x1', body:'hello', title:'X1', priority:5, audience:'all', requirement:'optional', categories:['Test'] }, overwrite:true } })+'\n');
  await waitFor(out, o=> o.id===2 && o.result !== undefined);
    // groom dry run
  proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:3, method:'instructions/groom', params:{ mode:{ dryRun:true } } })+'\n');
  await waitFor(out, o=> o.id===3 && o.result !== undefined);
    // remove
  proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:4, method:'instructions/remove', params:{ ids:['x1'], missingOk:true } })+'\n');
  await waitFor(out, o=> o.id===4 && o.result !== undefined);
    const addedFile = path.join(tmp,'x1.json');
    expect(fs.existsSync(addedFile)).toBe(false); // removed
    proc.kill();
  }, 8000);
});
