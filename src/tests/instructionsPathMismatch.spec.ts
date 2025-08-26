import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor } from './testUtils';

// Reproduction test: when starting the server from a different cwd (dist/server)
// additions should still appear in list immediately. Current bug: loader baseDir resolves
// to repo-root instructions while writes go to cwd/instructions causing new entries to be invisible.
// Expected (correct behavior): list after add contains the new id.
// This test should FAIL before the fix, proving reproduction.

function startServerInDist(){
  const distServer = path.join(process.cwd(),'dist','server');
  if(!fs.existsSync(distServer)) throw new Error('dist/server missing - build before test.');
  return spawn('node', [path.join(distServer,'index.js')], { stdio:['pipe','pipe','pipe'], cwd: distServer, env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServerInDist>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch { /* ignore */ } } return undefined; }

describe('repro: path mismatch add invisibility', () => {
  it('add should appear in list even when cwd differs (currently fails)', async () => {
    const server = startServerInDist();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'path-mismatch', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));

    // Baseline list count
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out,2));
    const listBaseline = findResponse(out,2) as RpcSuccess<{ items:{ id:string }[]; count:number }> | undefined;
    const baselineCount = listBaseline?.result.count || 0;

    const id = 'path-drift-' + Date.now();
    send(server,{ jsonrpc:'2.0', id:10, method:'instructions/add', params:{ entry:{ id, title:id, body:'Body', priority:10, audience:'all', requirement:'optional', categories:['test'], owner:'team:drift', version:'1.2.3', priorityTier:'P2' }, overwrite:true, lax:true } });
    await waitFor(()=> !!findResponse(out,10));

    // Immediately list again
    send(server,{ jsonrpc:'2.0', id:11, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out,11));
    const listAfter = findResponse(out,11) as RpcSuccess<{ items:{ id:string }[]; count:number }> | undefined;
    if(!listAfter) throw new Error('missing listAfter');

    // Failing expectation today: new id should be present and count incremented
    const ids = new Set(listAfter.result.items.map(i=> i.id));
    expect(ids.has(id), 'NEW ID NOT VISIBLE DUE TO PATH MISMATCH').toBe(true);
    expect(listAfter.result.count).toBeGreaterThanOrEqual(baselineCount + 1);

    server.kill();
  }, 15000);
});
