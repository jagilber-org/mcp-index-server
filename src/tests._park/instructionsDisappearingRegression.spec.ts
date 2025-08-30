import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload, ensureFileExists, ensureJsonReadable } from './testUtils';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-disappear-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

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
  await waitFor(()=> !!findLine(out1,1));

    // Baseline list count
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
    await waitFor(()=> !!findLine(out1,2));
    const baselinePayload = parseToolPayload<{ count:number }>(findLine(out1,2)!);
    const baseline = baselinePayload?.count ?? 0;

    // Add governance-rich entries
    let rpcId = 10;
    for(const id of richIds){
  send(server,{ jsonrpc:'2.0', id:rpcId, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:`Body for ${id}`, priority:30, audience:'all', requirement:'optional', categories:['diag','Sample'], owner:`owner-${id}`, version:'1.1.0', priorityTier:'P2', semanticSummary:`Summary ${id}` }, overwrite:true, lax:true } }});
      await waitFor(()=> !!findLine(out1,rpcId));
      rpcId++;
  const file = path.join(ISOLATED_DIR, `${id}.json`);
  await ensureFileExists(file, 4000);
  await ensureJsonReadable(file, 4000);
      const disk = JSON.parse(fs.readFileSync(file,'utf8')) as Record<string, unknown>;
      expect(disk.owner).toBe(`owner-${id}`);
      expect(disk.version).toBe('1.1.0');
      expect(disk.priorityTier).toBe('P2');
    }

    // Add minimal entry (should auto-derive governance)
  send(server,{ jsonrpc:'2.0', id:50, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:minimalId, title:minimalId, body:'Minimal body' }, lax:true, overwrite:true } }});
    await waitFor(()=> !!findLine(out1,50));
  const minimalFile = path.join(ISOLATED_DIR, `${minimalId}.json`);
  await ensureFileExists(minimalFile, 4000);
  await ensureJsonReadable(minimalFile, 4000);

    // Add short id entry with governance
  send(server,{ jsonrpc:'2.0', id:60, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:shortId, title:shortId, body:'Short body', priority:55, audience:'all', requirement:'optional', categories:['short'], owner:'short-owner', version:'2.0.0', priorityTier:'P3', semanticSummary:'Short summary' }, lax:true, overwrite:true } }});
    await waitFor(()=> !!findLine(out1,60));

    // Verify list includes all new ids
  send(server,{ jsonrpc:'2.0', id:70, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
    await waitFor(()=> !!findLine(out1,70));
    const listAfterAddPayload = parseToolPayload<{ items:{ id:string }[]; count:number }>(findLine(out1,70)!);
    if(!listAfterAddPayload) throw new Error('missing listAfterAdd');
    const afterIds = new Set(listAfterAddPayload.items.map(i=> i.id));
    for(const id of [...richIds, minimalId, shortId]){ expect(afterIds.has(id), `list missing ${id} pre-restart`).toBe(true); }
  expect(listAfterAddPayload.count).toBeGreaterThanOrEqual(baseline + richIds.length + 2);

    // Direct get each id to check retrieval path
    rpcId = 80;
    for(const id of [...richIds, minimalId, shortId]){
  send(server,{ jsonrpc:'2.0', id:rpcId, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } }});
      await waitFor(()=> !!findLine(out1,rpcId));
      const getPayload = parseToolPayload<{ item: Record<string,unknown> }>(findLine(out1,rpcId)!);
      expect(getPayload && getPayload.item.id).toBe(id);
      rpcId++;
    }

    server.kill();

    // Phase 2: restart and verify persistence
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server,{ jsonrpc:'2.0', id:101, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'persist-regression-2', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out2,101));

  send(server,{ jsonrpc:'2.0', id:102, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
    await waitFor(()=> !!findLine(out2,102));
    const listAfterRestartPayload = parseToolPayload<{ items:{ id:string; owner?:string; version?:string; priorityTier?:string }[] }>(findLine(out2,102)!);
    if(!listAfterRestartPayload) throw new Error('missing listAfterRestart');
    const restartIds = new Set(listAfterRestartPayload.items.map(i=> i.id));
    for(const id of [...richIds, minimalId, shortId]){ expect(restartIds.has(id), `post-restart list missing ${id}`).toBe(true); }

    // Governance preservation for rich + short ids
  const restartMap = new Map(listAfterRestartPayload.items.map(i=> [i.id,i] as const));
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
  send(server,{ jsonrpc:'2.0', id:200, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id: richIds[0] } }});
    await waitFor(()=> !!findLine(out2,200));
    const getAfterRestartPayload = parseToolPayload<{ item: Record<string,unknown> }>(findLine(out2,200)!);
    expect(getAfterRestartPayload && getAfterRestartPayload.item.id).toBe(richIds[0]);

    server.kill();
  }, 30000);
});
