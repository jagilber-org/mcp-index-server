import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch { /* ignore */ } } return undefined; }

// CRUD matrix: add -> get -> list presence -> governanceUpdate -> remove -> list absence -> restart -> absence persists.
// This test must remain green if and only if fundamental CRUD semantics are intact.

describe('CRUD matrix end-to-end', () => {
  it('add/get/list/governanceUpdate/remove persists correctly across restart', async () => {
    const id = 'crud-matrix-' + Date.now();

    // Start server
    let server = startServer();
    const out1: string[] = []; server.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-matrix', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out1,1));

    // Add
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/add', params:{ entry:{ id, title:id, body:'Body', priority:10, audience:'all', requirement:'optional', categories:['test'], owner:'team:test', version:'1.0.0', priorityTier:'P2' }, overwrite:true, lax:true } });
    await waitFor(()=> !!findResponse(out1,2));
    const filePath = path.join(process.cwd(),'instructions', `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    // Get
  send(server,{ jsonrpc:'2.0', id:3, method:'instructions/dispatch', params:{ action:'get', id } });
    await waitFor(()=> !!findResponse(out1,3));
    const getResp = findResponse(out1,3) as RpcSuccess<{ item: { id:string; owner?:string; version?:string; priorityTier?:string } }> | undefined;
    expect(getResp?.result.item.id).toBe(id);

    // List presence
  send(server,{ jsonrpc:'2.0', id:4, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out1,4));
    const listResp = findResponse(out1,4) as RpcSuccess<{ items:{ id:string }[] }> | undefined;
    expect(listResp && listResp.result.items.some(i=> i.id===id)).toBe(true);

    // Governance update (patch owner + patch bump none)
    send(server,{ jsonrpc:'2.0', id:5, method:'instructions/governanceUpdate', params:{ id, owner:'team:alpha', status:'approved', bump:'none' } });
    await waitFor(()=> !!findResponse(out1,5));
  send(server,{ jsonrpc:'2.0', id:6, method:'instructions/dispatch', params:{ action:'get', id } });
    await waitFor(()=> !!findResponse(out1,6));
    const afterGov = findResponse(out1,6) as RpcSuccess<{ item: { id:string; owner?:string; status?:string } }> | undefined;
    expect(afterGov?.result.item.owner).toBe('team:alpha');
    expect(afterGov?.result.item.id).toBe(id);

    // Remove
    send(server,{ jsonrpc:'2.0', id:7, method:'instructions/remove', params:{ ids:[id] } });
    await waitFor(()=> !!findResponse(out1,7));
    expect(fs.existsSync(filePath)).toBe(false);

    // List absence
  send(server,{ jsonrpc:'2.0', id:8, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out1,8));
    const listAfterRemove = findResponse(out1,8) as RpcSuccess<{ items:{ id:string }[] }> | undefined;
    expect(listAfterRemove && listAfterRemove.result.items.some(i=> i.id===id)).toBe(false);

    server.kill();

    // Restart and ensure still absent
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:20, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-matrix-2', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out2,20));

  send(server,{ jsonrpc:'2.0', id:21, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out2,21));
    const listAfterRestart = findResponse(out2,21) as RpcSuccess<{ items:{ id:string }[] }> | undefined;
    expect(listAfterRestart && listAfterRestart.result.items.some(i=> i.id===id)).toBe(false);

    // Get should likely return error (depending on handler semantics). We verify absence by list only; optional future: explicit get error assertion.
    server.kill();
  }, 20000);
});
