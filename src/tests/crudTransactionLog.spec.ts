import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';

function start(dir:string, logFile:string){
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR:dir, INSTRUCTIONS_AUDIT_LOG: logFile }});
}
function send(p:ReturnType<typeof start>, msg:Record<string,unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }
function find(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('CRUD transaction log (audit JSONL)', () => {
  it('captures add, governanceUpdate and remove actions', async () => {
    await waitForDist();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'crud-audit-'));
    const logFile = path.join(dir,'audit.log.jsonl');
    const proc = start(dir, logFile);
    const lines:string[]=[]; proc.stdout.on('data',d=> lines.push(...d.toString().trim().split(/\n+/))); proc.stderr.on('data',d=> lines.push(...d.toString().trim().split(/\n+/)));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-audit', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!find(lines,1),4000);
    // add
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:'audit-one', title:'a', body:'body', priority:1, audience:'all', requirement:'optional', categories:['a'] }, lax:true } }});
    await waitFor(()=> !!find(lines,2));
    // governanceUpdate
    send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/governanceUpdate', arguments:{ id:'audit-one', owner:'new-owner', bump:'patch' } }});
    await waitFor(()=> !!find(lines,3));
    // remove
    send(proc,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'remove', ids:['audit-one'] } }});
    await waitFor(()=> !!find(lines,4));
    // allow fs flush
    await new Promise(r=> setTimeout(r,150));
    expect(fs.existsSync(logFile)).toBe(true);
    const txt = fs.readFileSync(logFile,'utf8');
    const actions = txt.split(/\r?\n/).filter(l=> l.trim()).map(l=> { try { return JSON.parse(l).action; } catch { return 'parse-error'; } });
    // Ensure ordering subset
    const addIdx = actions.indexOf('add');
    const govIdx = actions.indexOf('governanceUpdate');
    const remIdx = actions.indexOf('remove');
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(govIdx).toBeGreaterThan(addIdx);
    expect(remIdx).toBeGreaterThan(govIdx);
    proc.kill();
  }, 15000);
});
