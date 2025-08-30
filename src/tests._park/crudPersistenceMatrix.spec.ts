import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';

function start(dir:string){
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR:dir }});
}
function send(p:ReturnType<typeof start>, msg:Record<string,unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }
function find(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('CRUD persistence matrix (multi-restart)', () => {
  it('persists adds across restart and removals across second restart', async () => {
    await waitForDist();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'crud-persist-'));
    const ids = Array.from({ length:6 },(_,i)=> `persist-${i}`);
    // First run add instructions
    {
      const proc = start(dir); const lines:string[]=[]; proc.stdout.on('data',d=> lines.push(...d.toString().trim().split(/\n+/))); proc.stderr.on('data',d=> lines.push(...d.toString().trim().split(/\n+/)));
      send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-persist1', version:'0' }, capabilities:{ tools:{} } }});
      await waitFor(()=> !!find(lines,1),4000);
      for(let i=0;i<ids.length;i++){
        const callId = 10+i;
        send(proc,{ jsonrpc:'2.0', id:callId, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:ids[i], title:ids[i], body:'body', priority: i, audience:'all', requirement:'optional', categories:['persist'] }, lax:true } }});
        await waitFor(()=> !!find(lines,callId),6000);
      }
      proc.kill();
    }
    // Verify files exist (cold check)
    ids.forEach(id=> expect(fs.existsSync(path.join(dir, id + '.json'))).toBe(true));
    // Second run remove half
    const toRemove = ids.slice(0,3);
    {
      const proc = start(dir); const lines:string[]=[]; proc.stdout.on('data',d=> lines.push(...d.toString().trim().split(/\n+/))); proc.stderr.on('data',d=> lines.push(...d.toString().trim().split(/\n+/)));
      send(proc,{ jsonrpc:'2.0', id:100, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-persist2', version:'0' }, capabilities:{ tools:{} } }});
      await waitFor(()=> !!find(lines,100),4000);
      send(proc,{ jsonrpc:'2.0', id:101, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'remove', ids: toRemove } }});
      await waitFor(()=> !!find(lines,101),6000);
      proc.kill();
    }
    // Third run validate remaining/removed
    {
      const proc = start(dir); const lines:string[]=[]; proc.stdout.on('data',d=> lines.push(...d.toString().trim().split(/\n+/))); proc.stderr.on('data',d=> lines.push(...d.toString().trim().split(/\n+/)));
      send(proc,{ jsonrpc:'2.0', id:200, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-persist3', version:'0' }, capabilities:{ tools:{} } }});
      await waitFor(()=> !!find(lines,200),4000);
      // list to ensure catalog consistent
      send(proc,{ jsonrpc:'2.0', id:201, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
      await waitFor(()=> !!find(lines,201),6000);
      proc.kill();
    }
    toRemove.forEach(id=> expect(fs.existsSync(path.join(dir,id+'.json'))).toBe(false));
    ids.slice(3).forEach(id=> expect(fs.existsSync(path.join(dir,id+'.json'))).toBe(true));
  }, 25000);
});
