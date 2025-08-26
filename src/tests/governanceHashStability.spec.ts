import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-govhash-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch { /* ignore */ } } return undefined; }

describe('governance hash stability across restart', () => {
  it('hash remains identical across restart with no writes', async () => {
    const id = `hash_stability_${Date.now()}`;
    let server = startServer();
    const out1: string[] = []; server.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'hash-test1', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out1,1));
    // Add deterministic entry with explicit governance
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/add', params:{ entry:{ id, title:id, body:'Hash body', priority:25, audience:'all', requirement:'optional', categories:['hash'], owner:'hash-owner', version:'1.0.1', priorityTier:'P2', semanticSummary:'Hash summary' }, overwrite:true, lax:true } });
    await waitFor(()=> !!findResponse(out1,2));
    send(server,{ jsonrpc:'2.0', id:3, method:'instructions/governanceHash', params:{} });
    await waitFor(()=> !!findResponse(out1,3));
    const firstResp = findResponse(out1,3) as RpcSuccess<{ governanceHash:string }> | undefined;
    if(!firstResp) throw new Error('missing first hash resp');
    const firstHash = firstResp.result.governanceHash;
    // Ensure file exists
  expect(fs.existsSync(path.join(ISOLATED_DIR, `${id}.json`))).toBe(true);
    server.kill();

    // Restart and compute hash again
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'hash-test2', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out2,10));
    send(server,{ jsonrpc:'2.0', id:11, method:'instructions/governanceHash', params:{} });
    await waitFor(()=> !!findResponse(out2,11));
    const secondResp = findResponse(out2,11) as RpcSuccess<{ governanceHash:string }> | undefined;
    if(!secondResp) throw new Error('missing second hash resp');
    const secondHash = secondResp.result.governanceHash;
    expect(secondHash).toBe(firstHash);

    server.kill();
  }, 20000);
});
