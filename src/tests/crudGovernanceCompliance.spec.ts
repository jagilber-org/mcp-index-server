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

describe('CRUD governance compliance (P1 & mandatory/critical)', () => {
  it('rejects non-compliant P1 (missing category or owner) and mandatory missing owner, accepts compliant', async () => {
    await waitForDist();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'crud-gov-'));
    const proc = start(dir);
    const lines:string[]=[]; proc.stdout.on('data',d=> lines.push(...d.toString().trim().split(/\n+/))); proc.stderr.on('data',d=> lines.push(...d.toString().trim().split(/\n+/)));
    // init
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-gov', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!find(lines,1),4000);

    // P1 missing category
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:'p1-missing-cat', title:'p1', body:'body', priority:10, audience:'all', requirement:'optional', categories:[], priorityTier:'P1', owner:'owner-a' }, lax:true } }});
    await waitFor(()=> !!find(lines,2));
    const p1MissingCat = find(lines,2)!; const p1CatObj = JSON.parse(p1MissingCat);
    expect(p1CatObj.result?.content?.[0]?.text || '').toMatch(/P1 requires category & owner/);

    // P1 missing owner
    send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:'p1-missing-owner', title:'p1o', body:'body', priority:11, audience:'all', requirement:'optional', categories:['x'], priorityTier:'P1' }, lax:true } }});
    await waitFor(()=> !!find(lines,3));
    const p1MissingOwner = JSON.parse(find(lines,3)!);
    expect(p1MissingOwner.result?.content?.[0]?.text || '').toMatch(/P1 requires category & owner/);

    // mandatory missing owner
    send(proc,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:'mand-missing-owner', title:'m', body:'body', priority:12, audience:'all', requirement:'mandatory', categories:['x'] }, lax:true } }});
    await waitFor(()=> !!find(lines,4));
    const mandMissingOwner = JSON.parse(find(lines,4)!);
    expect(mandMissingOwner.result?.content?.[0]?.text || '').toMatch(/mandatory\/critical require owner/);

    // compliant P1
    send(proc,{ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:'p1-good', title:'good', body:'body', priority:13, audience:'all', requirement:'optional', categories:['good'], priorityTier:'P1', owner:'good-owner' }, lax:true } }});
    await waitFor(()=> !!find(lines,5));
    const good = JSON.parse(find(lines,5)!);
    expect(good.result?.content?.[0]?.text || '').not.toMatch(/error/i);
    const file = path.join(dir,'p1-good.json');
    expect(fs.existsSync(file)).toBe(true);
    proc.kill();
  }, 15000);
});
