import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

// Minimal helper to extract JSON-RPC response lines by id
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function isSuccess<T>(r: RpcResponse<T>): r is RpcSuccess<T> { return !!r && 'result' in r; }
function findResponse(lines: string[], id: number): RpcResponse | undefined {
  for(const l of lines){
    try {
      const obj = JSON.parse(l) as RpcResponse;
      if(obj && obj.id === id) return obj;
    } catch { /* ignore parse */ }
  }
  return undefined;
}

describe('instructions/add persistence & governance coverage', () => {
  const instructionsDir = path.join(process.cwd(),'instructions');
  beforeAll(()=>{ if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir); });

  it('adds multiple unique instructions and retains all on list', async () => {
    // Create 5 fresh ids
    const ids = Array.from({ length:5 }, (_,i)=> `add_persist_${Date.now()}_${i}`);
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    // initialize
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'coverage', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));

    // Baseline list count
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out,2));
  const baselineResp = findResponse(out,2);
  const baseline = isSuccess(baselineResp)? (baselineResp.result as { count?:number }).count ?? 0 : 0;

    // Add each instruction (attempt to inject governance that should be ignored by add)
    for(let i=0;i<ids.length;i++){
      const id = ids[i];
      send(server,{ jsonrpc:'2.0', id:100+i, method:'instructions/add', params:{ entry:{ id, title:id, body:`Body ${i}`, priority:50+i, audience:'all', requirement:'optional', categories:['temp','Test'], owner:'should-not-stick', priorityTier:'P1', version:'9.9.9' }, lax:true, overwrite:true } });
      await waitFor(()=> !!findResponse(out,100+i));
      const file = path.join(instructionsDir, id + '.json');
      expect(fs.existsSync(file), `missing file for ${id}`).toBe(true);
      const disk = JSON.parse(fs.readFileSync(file,'utf8'));
      // Owner supplied is ignored (should be unowned or auto-resolved)
      expect(disk.owner).toBeDefined();
      expect(['unowned'].includes(disk.owner) || /^team-/.test(disk.owner)).toBe(true);
      // Version is normalized (not user supplied 9.9.9)
      expect(disk.version).toBe('1.0.0');
      // priorityTier derived from priority (should not accept injected P1 unless priority qualifies)
      if(disk.priority <= 20){ expect(disk.priorityTier).toBe('P1'); }
      else if(disk.priority <= 40){ expect(disk.priorityTier).toBe('P2'); }
      else if(disk.priority <= 70){ expect(disk.priorityTier).toBe('P3'); }
      else { expect(disk.priorityTier).toBe('P4'); }
    }

    // List again and ensure at least baseline+5 items present (none silently dropped)
    send(server,{ jsonrpc:'2.0', id:500, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out,500));
  const afterResp = findResponse(out,500);
  const after = isSuccess(afterResp)? (afterResp.result as { count?:number }).count ?? 0 : 0;
    expect(after).toBeGreaterThanOrEqual(baseline + ids.length);

    // Export just added ids to verify all retrievable
    send(server,{ jsonrpc:'2.0', id:600, method:'instructions/export', params:{ ids } });
    await waitFor(()=> !!findResponse(out,600));
  const exportResp = findResponse(out,600) as RpcSuccess<{ count:number; items:{ id:string }[] }> | undefined;
  expect(exportResp && exportResp.result.count).toBe(ids.length);
  if(!exportResp) throw new Error('missing export response');
  const exportedIds = new Set(exportResp.result.items.map(i=> i.id));
    ids.forEach(id=> expect(exportedIds.has(id)).toBe(true));

    server.kill();
  }, 15000);
});
