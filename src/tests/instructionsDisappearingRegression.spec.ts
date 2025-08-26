import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-disappear-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch { /* ignore */ } } return undefined; }

// Regression guard for reported disappearing instructions & governance stripping

describe('regression: added instructions persist across restart and retain governance', () => {
  it('adds 3 governance-rich + 1 minimal + 1 short id entry, verifies list/get before & after restart', async () => {
    const richIds = [
      'service-fabric-diagnostic-methodology',
      'workspace-tool-usage-patterns',
      'obfuscation-pattern-gaps-2025'
    ].map(x => `${x}-${Date.now()}`); // ensure uniqueness per test run
    const minimalId = `x1_${Date.now()}`;
    const shortId = `sf_dx_${Date.now()}`;

    // Phase 1: start server and add entries
    let server = startServer();
    const out1: string[] = []; server.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'persist-regression', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out1,1));

    // Baseline list count
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out1,2));
    const baselineResp = findResponse(out1,2) as RpcSuccess<{ count:number }> | undefined;
    const baseline = baselineResp? baselineResp.result.count : 0;

    // Add governance-rich entries
    let rpcId = 10;
    for(const id of richIds){
      send(server,{ jsonrpc:'2.0', id:rpcId, method:'instructions/add', params:{ entry:{ id, title:id, body:`Body for ${id}`, priority:30, audience:'all', requirement:'optional', categories:['diag','Sample'], owner:`owner-${id}`, version:'1.1.0', priorityTier:'P2', semanticSummary:`Summary ${id}` }, overwrite:true, lax:true } });
      await waitFor(()=> !!findResponse(out1,rpcId));
      rpcId++;
  const file = path.join(ISOLATED_DIR, `${id}.json`);
      expect(fs.existsSync(file), `missing file ${id}`).toBe(true);
      const disk = JSON.parse(fs.readFileSync(file,'utf8')) as Record<string, unknown>;
      expect(disk.owner).toBe(`owner-${id}`);
      expect(disk.version).toBe('1.1.0');
      expect(disk.priorityTier).toBe('P2');
    }

    // Add minimal entry (should auto-derive governance)
    send(server,{ jsonrpc:'2.0', id:50, method:'instructions/add', params:{ entry:{ id:minimalId, title:minimalId, body:'Minimal body' }, lax:true, overwrite:true } });
    await waitFor(()=> !!findResponse(out1,50));
  const minimalFile = path.join(ISOLATED_DIR, `${minimalId}.json`);
    expect(fs.existsSync(minimalFile)).toBe(true);

    // Add short id entry with governance
    send(server,{ jsonrpc:'2.0', id:60, method:'instructions/add', params:{ entry:{ id:shortId, title:shortId, body:'Short body', priority:55, audience:'all', requirement:'optional', categories:['short'], owner:'short-owner', version:'2.0.0', priorityTier:'P3', semanticSummary:'Short summary' }, lax:true, overwrite:true } });
    await waitFor(()=> !!findResponse(out1,60));

    // Verify list includes all new ids
    send(server,{ jsonrpc:'2.0', id:70, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out1,70));
    const listAfterAdd = findResponse(out1,70) as RpcSuccess<{ items:{ id:string }[]; count:number }> | undefined;
    if(!listAfterAdd) throw new Error('missing listAfterAdd');
    const afterIds = new Set(listAfterAdd.result.items.map(i=> i.id));
    for(const id of [...richIds, minimalId, shortId]){ expect(afterIds.has(id), `list missing ${id} pre-restart`).toBe(true); }
    expect(listAfterAdd.result.count).toBeGreaterThanOrEqual(baseline + richIds.length + 2);

    // Direct get each id to check retrieval path
    rpcId = 80;
    for(const id of [...richIds, minimalId, shortId]){
      send(server,{ jsonrpc:'2.0', id:rpcId, method:'instructions/get', params:{ id } });
      await waitFor(()=> !!findResponse(out1,rpcId));
      const resp = findResponse(out1,rpcId) as RpcSuccess<{ item: Record<string, unknown> }> | undefined;
      expect(resp && resp.result.item.id).toBe(id);
      rpcId++;
    }

    server.kill();

    // Phase 2: restart and verify persistence
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server,{ jsonrpc:'2.0', id:101, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'persist-regression-2', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out2,101));

    send(server,{ jsonrpc:'2.0', id:102, method:'instructions/list', params:{} });
    await waitFor(()=> !!findResponse(out2,102));
    const listAfterRestart = findResponse(out2,102) as RpcSuccess<{ items:{ id:string; owner?:string; version?:string; priorityTier?:string }[] }> | undefined;
    if(!listAfterRestart) throw new Error('missing listAfterRestart');
    const restartIds = new Set(listAfterRestart.result.items.map(i=> i.id));
    for(const id of [...richIds, minimalId, shortId]){ expect(restartIds.has(id), `post-restart list missing ${id}`).toBe(true); }

    // Governance preservation for rich + short ids
    const restartMap = new Map(listAfterRestart.result.items.map(i=> [i.id,i] as const));
    for(const id of richIds){
      const item = restartMap.get(id)!;
      expect(item.owner).toBe(`owner-${id}`);
      expect(item.version).toBe('1.1.0');
      expect(item.priorityTier).toBe('P2');
    }
    const shortItem = restartMap.get(shortId)!;
    expect(shortItem.owner).toBe('short-owner');
    expect(shortItem.version).toBe('2.0.0');
    expect(shortItem.priorityTier).toBe('P3');

    // Minimal id should have derived fields (owner maybe unowned, version default) but must remain present
    expect(restartMap.has(minimalId)).toBe(true);

    // Direct get after restart for one rich id
    send(server,{ jsonrpc:'2.0', id:200, method:'instructions/get', params:{ id: richIds[0] } });
    await waitFor(()=> !!findResponse(out2,200));
    const getAfterRestart = findResponse(out2,200) as RpcSuccess<{ item: Record<string, unknown> }> | undefined;
    expect(getAfterRestart && getAfterRestart.result.item.id).toBe(richIds[0]);

    server.kill();
  }, 30000);
});
