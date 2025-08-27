import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines: string[], id:number): string | undefined { return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

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
  await waitFor(()=> !!findLine(out1,1));

    // Add
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Body', priority:10, audience:'all', requirement:'optional', categories:['test'], owner:'team:test', version:'1.0.0', priorityTier:'P2' }, overwrite:true, lax:true } } });
  await waitFor(()=> !!findLine(out1,2));
    const filePath = path.join(process.cwd(),'instructions', `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    // Get
  send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } } });
  await waitFor(()=> !!findLine(out1,3));
  const getLine = findLine(out1,3);
  const getPayload = getLine ? parseToolPayload<{ item:{ id:string; owner?:string; version?:string; priorityTier?:string } }>(getLine) : undefined;
  expect(getPayload?.item.id).toBe(id);

    // List presence
  send(server,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> !!findLine(out1,4));
  const listLine = findLine(out1,4);
  const listPayload = listLine ? parseToolPayload<{ items:{ id:string }[] }>(listLine) : undefined;
  expect(listPayload?.items.some(i=> i.id===id)).toBe(true);

    // Governance update (patch owner + patch bump none)
  send(server,{ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'governanceUpdate', id, owner:'team:alpha', status:'approved', bump:'none' } } });
  await waitFor(()=> !!findLine(out1,5));
  send(server,{ jsonrpc:'2.0', id:6, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } } });
  await waitFor(()=> !!findLine(out1,6));
  const afterGovLine = findLine(out1,6);
  const afterGovPayload = afterGovLine ? parseToolPayload<{ item:{ id:string; owner?:string; status?:string } }>(afterGovLine) : undefined;
  expect(afterGovPayload?.item.owner).toBe('team:alpha');
  expect(afterGovPayload?.item.id).toBe(id);

    // Remove
  send(server,{ jsonrpc:'2.0', id:7, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'remove', ids:[id] } } });
  await waitFor(()=> !!findLine(out1,7));
    expect(fs.existsSync(filePath)).toBe(false);

    // List absence
  send(server,{ jsonrpc:'2.0', id:8, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> !!findLine(out1,8));
  const listAfterRemoveLine = findLine(out1,8);
  const listAfterRemovePayload = listAfterRemoveLine ? parseToolPayload<{ items:{ id:string }[] }>(listAfterRemoveLine) : undefined;
  expect(listAfterRemovePayload?.items.some(i=> i.id===id)).toBe(false);

    server.kill();

    // Restart and ensure still absent
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:20, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'crud-matrix-2', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out2,20));

  send(server,{ jsonrpc:'2.0', id:21, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> !!findLine(out2,21));
  const listAfterRestartLine = findLine(out2,21);
  const listAfterRestartPayload = listAfterRestartLine ? parseToolPayload<{ items:{ id:string }[] }>(listAfterRestartLine) : undefined;
  expect(listAfterRestartPayload?.items.some(i=> i.id===id)).toBe(false);

    // Get should likely return error (depending on handler semantics). We verify absence by list only; optional future: explicit get error assertion.
    server.kill();
  }, 20000);
});
