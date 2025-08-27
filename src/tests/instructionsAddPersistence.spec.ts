import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-persist-'));
async function ensureDist(){ await waitForDist(); }
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
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
  const instructionsDir = ISOLATED_DIR;
  beforeAll(()=>{ if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir); });

  it('adds multiple unique instructions and retains all on list', async () => {
    // Create 5 fresh ids
    const ids = Array.from({ length:5 }, (_,i)=> `add_persist_${Date.now()}_${i}`);
  await ensureDist();
  const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    // initialize
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'coverage', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));

    // Baseline list count
  send(server,{ jsonrpc:'2.0', id:2, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out,2));
  const baselineResp = findResponse(out,2);
  const baseline = isSuccess(baselineResp)? (baselineResp.result as { count?:number }).count ?? 0 : 0;

  // Add each instruction (now governance fields should persist exactly as provided for alpha)
    for(let i=0;i<ids.length;i++){
      const id = ids[i];
  send(server,{ jsonrpc:'2.0', id:100+i, method:'instructions/add', params:{ entry:{ id, title:id, body:`Body ${i}`, priority:50+i, audience:'all', requirement:'optional', categories:['temp','Test'], owner:`owner-${i}`, priorityTier:'P1', version:'9.9.9', classification:'internal', semanticSummary:`Custom summary ${i}` }, lax:true, overwrite:true } });
      await waitFor(()=> !!findResponse(out,100+i));
      const file = path.join(instructionsDir, id + '.json');
      expect(fs.existsSync(file), `missing file for ${id}`).toBe(true);
      const disk = JSON.parse(fs.readFileSync(file,'utf8'));
  // Owner supplied is preserved
  expect(disk.owner).toBe(`owner-${i}`);
  // Version is preserved (no auto-normalization)
  expect(disk.version).toBe('9.9.9');
  // priorityTier preserved (no derivation override at add time now)
  expect(disk.priorityTier).toBe('P1');
  // semanticSummary preserved
  expect(disk.semanticSummary).toBe(`Custom summary ${i}`);
    }

    // List again and ensure at least baseline+5 items present (none silently dropped)
  send(server,{ jsonrpc:'2.0', id:500, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!findResponse(out,500));
  const afterResp = findResponse(out,500);
  const after = isSuccess(afterResp)? (afterResp.result as { count?:number }).count ?? 0 : 0;
    expect(after).toBeGreaterThanOrEqual(baseline + ids.length);

    // Export just added ids to verify all retrievable
  send(server,{ jsonrpc:'2.0', id:600, method:'instructions/dispatch', params:{ action:'export', ids } });
    await waitFor(()=> !!findResponse(out,600));
  const exportResp = findResponse(out,600) as RpcSuccess<{ count:number; items:{ id:string }[] }> | undefined;
  expect(exportResp && exportResp.result.count).toBe(ids.length);
  if(!exportResp) throw new Error('missing export response');
  const exportedIds = new Set(exportResp.result.items.map(i=> i.id));
    ids.forEach(id=> expect(exportedIds.has(id)).toBe(true));

    server.kill();
  }, 15000);
});
