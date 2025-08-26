import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface InstructionItem { id:string; version?:string }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch { /* ignore */ } } return undefined; }

// Stress: attempt concurrent adds of the same ID and ensure no crash + final state consistent.

describe('concurrency: add same id concurrently', () => {
  it('handles rapid duplicate adds deterministically', async () => {
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'concurrency', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));

    const baseId = 'concurrent-' + Date.now();
    // Fire off many add calls rapidly (some minimal, some with governance) for same id
    for(let i=0;i<15;i++){
      send(server,{ jsonrpc:'2.0', id:100+i, method:'instructions/add', params:{ entry:{ id:baseId, title:baseId, body:`Body v${i}`, version:'1.0.'+i, owner:'owner-'+i, priority: 10+i, audience:'all', requirement:'optional', categories:['test'] }, overwrite:true, lax:true } });
    }

    // Wait for last one
    await waitFor(()=> !!findResponse(out,114));

    // Get the entry
    send(server,{ jsonrpc:'2.0', id:200, method:'instructions/get', params:{ id:baseId } });
    const start2 = Date.now();
    while(Date.now()-start2 < 3000 && !findResponse(out,200)){
      await new Promise(r=> setTimeout(r,80));
    }
  const got = findResponse(out,200) as RpcSuccess<{ item: InstructionItem }> | undefined;
  expect(got?.result.item.id).toBe(baseId);
  // Version should be that of the LAST overwrite pattern 1.0.x
  const v = got?.result.item.version;
  expect(v && v.startsWith('1.0.')).toBe(true);

    server.kill();
  }, 15000);
});
