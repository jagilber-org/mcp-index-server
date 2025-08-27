import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(dir:string){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: dir } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
function findResponse(lines: string[], id:number){
  for(const l of lines){
    try {
      const o = JSON.parse(l) as unknown;
      if(typeof o === 'object' && o!==null && 'id' in o && typeof (o as {id:unknown}).id === 'number' && (o as {id:number}).id === id){
        return o as RpcSuccess|RpcError;
      }
    } catch { /* ignore parse */ }
  }
}

// Verifies that .catalog-version marker mtime increases across a mutation and second server invalidates cache without forced reload flag.

describe('catalog version marker invalidation', () => {
  it('touches marker on add and second process sees new entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-vermarker-'));
    const marker = path.join(dir,'.catalog-version');
    // Pre-create directory without marker
    if(fs.existsSync(marker)) fs.unlinkSync(marker);

    const serverA = startServer(dir); const outA:string[]=[]; serverA.stdout.on('data',d=> outA.push(...d.toString().trim().split(/\n+/))); await new Promise(r=>setTimeout(r,120));
    send(serverA,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'vmA', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(outA,1), 3000);

    const serverB = startServer(dir); const outB:string[]=[]; serverB.stdout.on('data',d=> outB.push(...d.toString().trim().split(/\n+/))); await new Promise(r=>setTimeout(r,120));
    send(serverB,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'vmB', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(outB,1), 3000);

    // Prime B cache (empty list)
  send(serverB,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> !!findResponse(outB,2), 3000);

    const beforeMtime = fs.existsSync(marker)? fs.statSync(marker).mtimeMs : 0;

    const newId = 'marker-' + Date.now();
  send(serverA,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:newId, body:'body', title:newId, priority:5, audience:'all', requirement:'optional', categories:['vm'] }, overwrite:true } } });
    await waitFor(()=> !!findResponse(outA,2), 3000);

    // Marker should exist and have newer mtime
    expect(fs.existsSync(marker)).toBe(true);
    const afterMtime = fs.statSync(marker).mtimeMs;
    expect(afterMtime).toBeGreaterThan(beforeMtime);

    // B lists again and should see newId via version invalidation
  send(serverB,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> !!findResponse(outB,3), 3000);
  const listLine = outB.find(l=> { try { return JSON.parse(l).id===3; } catch { return false; } });
  const payload = listLine? parseToolPayload<{ items:{ id:string }[] }>(listLine): undefined;
  expect(!!payload && payload.items.some(i=> i.id===newId)).toBe(true);

    serverA.kill(); serverB.kill();
  }, 12000);
});
