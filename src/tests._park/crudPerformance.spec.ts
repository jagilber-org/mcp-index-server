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

describe('CRUD performance (batch add throughput)', () => {
  it('adds 20 instructions within reasonable time (<5s total)', async () => {
    await waitForDist();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'crud-perf-'));
    const proc = start(dir);
    const lines:string[]=[]; proc.stdout.on('data',d=> lines.push(...d.toString().trim().split(/\n+/))); proc.stderr.on('data',d=> lines.push(...d.toString().trim().split(/\n+/)));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-perf', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!find(lines,1),4000);
    const startTime = Date.now();
    const count = 20;
    for(let i=0;i<count;i++){
      const id = 100+i;
      send(proc,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:`perf-${i}`, title:`p${i}`, body:'body', priority: i, audience:'all', requirement:'optional', categories:['perf'] }, lax:true } }});
      await waitFor(()=> !!find(lines,id),6000);
    }
    const elapsed = Date.now() - startTime;
    // Soft performance assertion
    expect(elapsed).toBeLessThan(5000);
    // Validate all files exist
    for(let i=0;i<20;i++) expect(fs.existsSync(path.join(dir,`perf-${i}.json`))).toBe(true);
    proc.kill();
  }, 20000);
});
