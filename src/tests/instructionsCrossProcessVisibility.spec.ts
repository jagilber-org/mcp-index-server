import { describe, it, expect } from 'vitest';
import { parseToolPayload } from './testUtils';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { waitFor } from './testUtils';

// Reproduces multi-process stale cache: second server caches directory latestMTime from a sentinel file
// whose mtime is set far in the future; additions with earlier mtimes are not detected because
// ensureLoaded() only compares max mtime, ignoring filename set changes.

function startServer(dir:string){
  // Rely on .catalog-version marker invalidation; no forced reload flag needed.
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: dir } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch {/* ignore */} } return undefined; }

describe('cross-process visibility (expected to FAIL until cache invalidation improved)', () => {
  // TODO(#cross-process-cache): add directory watcher or periodic hash invalidation to refresh second process cache.
    it('newly added instruction by serverA is visible to serverB after reload cycle (tight)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-xproc-'));
    // Create sentinel file with NON-placeholder governance fields so enrichment does not rewrite (preserving future mtime)
    const sentinelId = 'zzz-sentinel';
    const sentinelPath = path.join(dir, `${sentinelId}.json`);
    const nowIso = new Date().toISOString();
    const body = 'sentinel body';
    const sentinel = {
      id: sentinelId, title: 'sentinel', body, rationale: 'cache test', priority: 1, audience: 'all', requirement: 'optional', categories: ['test'],
      sourceHash: 'deadbeef', schemaVersion: '1', createdAt: nowIso, updatedAt: nowIso, version: '1.0.0', status: 'approved', owner: 'team:sentinel',
      priorityTier: 'P3', classification: 'internal', lastReviewedAt: nowIso, nextReviewDue: nowIso, changeLog: [{ version:'1.0.0', changedAt: nowIso, summary:'init'}], semanticSummary: 'sentinel summary'
    };
    fs.writeFileSync(sentinelPath, JSON.stringify(sentinel,null,2));
    // Set future mtime far ahead (24h) so later files have lower mtime
    const future = new Date(Date.now() + 24*60*60*1000);
    fs.utimesSync(sentinelPath, future, future);

  // Start Server B (will hold stale cache after we intentionally prime it with an initial list BEFORE the add)
    const serverB = startServer(dir);
    const outB: string[] = []; serverB.stdout.on('data', d=> outB.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,140));
    send(serverB,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'xproc-B', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(outB,1), 3000);
  // Prime cache: first list BEFORE new file exists — loads catalog containing only sentinel
  send(serverB,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> !!findResponse(outB,2), 3000);

    // Start Server A which will perform add
    const serverA = startServer(dir);
    const outA: string[] = []; serverA.stdout.on('data', d=> outA.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,140));
    send(serverA,{ jsonrpc:'2.0', id:2, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'xproc-A', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(outA,2), 3000);

    const newId = 'xproc-new-' + Date.now();
  send(serverA,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:newId, body:'body', title:newId, priority:10, audience:'all', requirement:'optional', categories:['test'] }, lax:false, overwrite:true } } });
  await waitFor(()=> !!findResponse(outA,3), 3000);
  // Local disk assertion: file exists physically
  const newPath = path.join(dir, `${newId}.json`);
  expect(fs.existsSync(newPath)).toBe(true);

    // Sanity: Server A sees it in list
  send(serverA,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> !!findResponse(outA,4), 3000);
  const listAenv = findResponse(outA,4);
  const listApayload = listAenv ? parseToolPayload<{ items:{ id:string }[] }>(JSON.stringify(listAenv)) : undefined;
  expect(listApayload?.items.some(i=> i.id===newId)).toBe(true); // sanity

    // Server B lists AFTER add. Due to bug, stale cache likely omits newId. We assert presence (so current code FAILS).
    // Gather diagnostic directory view from serverB before polling
  send(serverB,{ jsonrpc:'2.0', id:40, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'dir' } } });
    await waitFor(()=> !!findResponse(outB,40), 2000);
    const dirViewBefore = findResponse(outB,40) as RpcSuccess<{ files:string[] }> | undefined;
    // Poll a few times (eventual consistency within short window should be guaranteed by signature invalidation)
    let saw=false; const maxAttempts=5;
    for(let attempt=0; attempt<maxAttempts && !saw; attempt++){
  send(serverB,{ jsonrpc:'2.0', id:10+attempt, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
      await waitFor(()=> !!findResponse(outB,10+attempt), 1200);
  const listBenv = findResponse(outB,10+attempt);
  const listBpayload = listBenv ? parseToolPayload<{ items:{ id:string }[] }>(JSON.stringify(listBenv)) : undefined;
  saw = !!listBpayload?.items.some(i=> i.id===newId);
      if(!saw) await new Promise(r=> setTimeout(r,120));
    }
    if(!saw){
      // Fetch directory after polling
  send(serverB,{ jsonrpc:'2.0', id:90, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'dir' } } });
      await waitFor(()=> !!findResponse(outB,90), 2000);
      const dirViewAfter = findResponse(outB,90) as RpcSuccess<{ files:string[] }> | undefined;
      // Force failure with diagnostic context
      expect({
        newId,
        localFiles: fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort(),
        serverB_before: dirViewBefore?.result.files,
        serverB_after: dirViewAfter?.result.files
      }).toEqual('visibility');
    }
    expect(saw).toBe(true);

    serverA.kill(); serverB.kill();
  }, 20000);
});
