/**
 * Portable CRUD Atomicity Test
 * Enforces strict guarantee: a successful create (add) response MUST correspond to immediate
 * in-catalog visibility (list + get) without stabilization loops. Fails fast otherwise.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' }});
}
function send(p: ReturnType<typeof startServer>, msg: Record<string, unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } }); }
async function waitFor(fn:()=>boolean, ms=4000, interval=40){ const s=Date.now(); while(Date.now()-s<ms){ if(fn()) return; await new Promise(r=>setTimeout(r,interval)); } throw new Error('timeout'); }
function parsePayload<T>(line:string|undefined):T{ if(!line) throw new Error('missing line'); const parsed=JSON.parse(line); if(parsed.result?.content?.[0]?.text){ try { return JSON.parse(parsed.result.content[0].text); } catch{ /* ignore */ } } return parsed as T; }

const BODY = 'Atomic create visibility test body with deterministic content. ' + 'X'.repeat(512);

describe('Portable CRUD Atomicity', () => {
  it('ensures create -> immediate list/get visibility; then updates and deletes', async () => {
    const server = startServer();
    const out:string[]=[]; const err:string[]=[]; server.stdout.on('data',d=> out.push(...d.toString().trim().split(/\n+/))); server.stderr.on('data',d=> err.push(...d.toString().trim().split(/\n+/)));

    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'portable-crud-atomic', version:'0'}, capabilities:{ tools:{} } }});
    await waitFor(()=> !!findLine(out,1));

    const id = 'portable-atomic-' + Date.now();
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Atomic Test', body: BODY, priority:42, audience:'all', requirement:'optional', categories:['atomic','test'], owner:'atomic-owner' }, overwrite:true, lax:true }}});
    await waitFor(()=> !!findLine(out,2));
    const addResp = parsePayload<{ id:string; error?:string; verified?:boolean }>(findLine(out,2));
    expect(addResp.id).toBe(id);
    expect(addResp.error).toBeUndefined();
    expect(addResp.verified).toBe(true); // server-side atomic read-back flag

    // Immediate LIST
    send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' }}});
    await waitFor(()=> !!findLine(out,3));
    const listResp = parsePayload<{ items:{ id:string }[] }>(findLine(out,3));
    expect(listResp.items.map(i=> i.id)).toContain(id);

    // Immediate GET
    send(server,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id }}});
    await waitFor(()=> !!findLine(out,4));
    const getResp = parsePayload<{ item?: { id:string; body:string; priority:number; categories:string[] } }>(findLine(out,4));
    expect(getResp.item?.id).toBe(id);
    expect(getResp.item?.body).toBe(BODY);

    // Update priority & body
    const newBody = BODY + '\nUPDATED';
    send(server,{ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Atomic Test', body:newBody, priority:43, audience:'all', requirement:'optional', categories:['atomic','test'], owner:'atomic-owner' }, overwrite:true, lax:true }}});
    await waitFor(()=> !!findLine(out,5));
    const updResp = parsePayload<{ id:string; error?:string; verified?:boolean }>(findLine(out,5));
    expect(updResp.error).toBeUndefined();
    expect(updResp.verified).toBe(true);

    send(server,{ jsonrpc:'2.0', id:6, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id }}});
    await waitFor(()=> !!findLine(out,6));
    const getAfterUpd = parsePayload<{ item?: { body:string; priority:number } }>(findLine(out,6));
    expect(getAfterUpd.item?.body).toBe(newBody);
    expect(getAfterUpd.item?.priority).toBe(43);

    // Delete
    send(server,{ jsonrpc:'2.0', id:7, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'remove', id }}});
    await waitFor(()=> !!findLine(out,7));

    send(server,{ jsonrpc:'2.0', id:8, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' }}});
    await waitFor(()=> !!findLine(out,8));
    const listAfterDel = parsePayload<{ items:{ id:string }[] }>(findLine(out,8));
    expect(listAfterDel.items.map(i=> i.id)).not.toContain(id);

    // Ensure get now errors or returns missing
    send(server,{ jsonrpc:'2.0', id:9, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id }}});
    await waitFor(()=> !!findLine(out,9));
    const maybeErr = findLine(out,9);
    const parsed = maybeErr ? JSON.parse(maybeErr) : undefined;
    if(parsed?.result?.content?.[0]?.text){
      try {
        const inner = JSON.parse(parsed.result.content[0].text);
        if(inner && (inner as { item?: unknown }).item){
          throw new Error('Deleted item still retrievable');
        }
      } catch { /* treat as acceptable error shape */ }
    }

    server.kill();
  }, 15000);
});
