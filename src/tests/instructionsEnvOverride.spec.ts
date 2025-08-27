import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';

// Verifies INSTRUCTIONS_DIR env variable forces both load & write operations
// into the same explicit directory (pinned). Ensures add + list + persistence across restart.

function startServer(customDir: string){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { cwd: process.cwd(), env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: customDir } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && typeof (o as { id?: unknown }).id === 'number' && (o as { id:number }).id===id) return o; } catch { /* ignore */ } } return undefined; }

describe('env override INSTRUCTIONS_DIR', () => {
  it('writes, lists, and persists in custom dir', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'instr-env-'));
    const server1 = startServer(tmp);
    const out1: string[] = []; server1.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server1,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'env-override', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out1,1));

    // Baseline list
  send(server1,{ jsonrpc:'2.0', id:2, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out1,2));
    const baseResp = findResponse(out1,2) as RpcSuccess<{ count:number; items:{id:string}[] }> | undefined;
    const baseCount = baseResp?.result.count || 0;

    const id = 'env-dir-' + Date.now();
    send(server1,{ jsonrpc:'2.0', id:3, method:'instructions/add', params:{ entry:{ id, title:id, body:'Body', priority:5, audience:'all', requirement:'optional', categories:['env'], owner:'team:env', version:'0.0.1' }, overwrite:true, lax:true } });
    await waitFor(()=> !!findResponse(out1,3));

  send(server1,{ jsonrpc:'2.0', id:4, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out1,4));
    const afterResp = findResponse(out1,4) as RpcSuccess<{ count:number; items:{id:string}[] }> | undefined;
    if(!afterResp) throw new Error('missing afterResp');
    const idsAfter = new Set(afterResp.result.items.map(i=> i.id));
    expect(idsAfter.has(id)).toBe(true);
    expect(afterResp.result.count).toBeGreaterThanOrEqual(baseCount + 1);

    // Confirm file exists in custom dir
    const filePath = path.join(tmp, `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    server1.kill();

    // Restart new process pointing to same dir -> should list same id without re-adding
    const server2 = startServer(tmp);
    const out2: string[] = []; server2.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server2,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'env-override-2', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out2,10));

  send(server2,{ jsonrpc:'2.0', id:11, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out2,11));
    const restartResp = findResponse(out2,11) as RpcSuccess<{ count:number; items:{id:string}[] }> | undefined;
    if(!restartResp) throw new Error('missing restartResp');
    const idsRestart = new Set(restartResp.result.items.map(i=> i.id));
    expect(idsRestart.has(id)).toBe(true);

    server2.kill();
  }, 20000);
});
