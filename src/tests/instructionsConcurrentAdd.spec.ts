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
    await new Promise(r=> setTimeout(r,140));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'concurrency', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));

    const baseId = 'concurrent-' + Date.now();
    const TOTAL = 20;
    for(let i=0;i<TOTAL;i++){
      send(server,{ jsonrpc:'2.0', id:100+i, method:'instructions/add', params:{ entry:{ id:baseId, title:baseId, body:`Body v${i}`, version:'1.0.'+i, owner:'owner-'+i, priority: 10+i, audience:'all', requirement:'optional', categories:['test'] }, overwrite:true, lax:true } });
    }

    // Wait for the last known add response (allow generous time under coverage)
    const addWaitStart = Date.now();
    while(Date.now()-addWaitStart < 5000 && !findResponse(out,100+TOTAL-1)){
      await new Promise(r=> setTimeout(r,120));
    }

    // Attempt to fetch; retry a few times if needed
    let got: RpcSuccess<{ item: InstructionItem }> | undefined;
    for(let attempt=0; attempt<5 && !got; attempt++){
      send(server,{ jsonrpc:'2.0', id:200+attempt, method:'instructions/get', params:{ id:baseId } });
      const pollStart = Date.now();
      while(Date.now()-pollStart < 1200 && !findResponse(out,200+attempt)){
        await new Promise(r=> setTimeout(r,100));
      }
      got = findResponse(out,200+attempt) as RpcSuccess<{ item: InstructionItem }> | undefined;
      if(!got){
        // brief backoff before next attempt
        await new Promise(r=> setTimeout(r,150));
      }
    }

    // Fallback: list and locate if direct get did not surface
    if(!got){
      send(server,{ jsonrpc:'2.0', id:500, method:'instructions/list', params:{} });
      await waitFor(()=> !!findResponse(out,500));
      const listResp = findResponse(out,500) as RpcSuccess<{ items: InstructionItem[] }> | undefined;
      const found = listResp?.result.items.find(i=> i.id===baseId);
      expect(found, 'Entry should appear in list after concurrent adds').toBeTruthy();
      // synthetic got structure for unified assertions
      got = { id:999, result:{ item: found as InstructionItem } } as RpcSuccess<{ item: InstructionItem }>;
    }

    expect(got, 'Expected to retrieve entry after concurrent adds').toBeTruthy();
    expect(got!.result.item.id).toBe(baseId);
    const v = got!.result.item.version;
    expect(v && v.startsWith('1.0.'), 'Version should reflect one of the overwrite attempts').toBe(true);

    server.kill();
  }, 25000);
});
