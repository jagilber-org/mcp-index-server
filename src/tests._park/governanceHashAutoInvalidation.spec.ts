import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { parseToolPayload, ensureDir, waitForServerReady, getResponse, ensureJsonReadable } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms));

const instructionsDir = path.join(process.cwd(),'instructions');
interface GovProjection { id:string; title:string; version:string; owner:string; priorityTier:string; nextReviewDue:string; semanticSummarySha256:string; changeLogLength:number }

describe('governance hash auto invalidation (mtime)', () => {
  it('updates governanceHash after owner metadata change without explicit reload', async () => {
    ensureDir(instructionsDir);
    const id = 'gov_hash_auto_invalidation';
    const file = path.join(instructionsDir, id + '.json');
    const now = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify({ id, title:'Gov Hash Auto', body:'Stable Body', priority:5, audience:'all', requirement:'mandatory', categories:['auto'], sourceHash:'', schemaVersion:'1', createdAt:now, updatedAt:now, version:'1.0.0', status:'approved', owner:'team-x', priorityTier:'P2', classification:'internal', lastReviewedAt:now, nextReviewDue:now, changeLog:[{version:'1.0.0', changedAt:now, summary:'initial'}], semanticSummary:'Stable Body' },null,2));
    // Ensure write fully flushed before server scans directory
    await ensureJsonReadable(file, 6000);
    // Distinct mtime window for subsequent metadata-only update (avoid coarse mtime coalescing)
    await sleep(1100);
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    // Readiness (high id band 6400+)
    await waitForServerReady(server, out, { initId:6400, metaId:6401, probeList:true, listId:6402 });
    // First governanceHash snapshot
    send(server,{ jsonrpc:'2.0', id:6403, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
    const firstEnv = await getResponse(out,6403,6000);
    const firstPayload = parseToolPayload<{ governanceHash:string; items:GovProjection[] }>(JSON.stringify(firstEnv));
    if(!firstPayload) throw new Error('missing first governanceHash payload');
    const firstHash = firstPayload.governanceHash;
    expect(typeof firstHash).toBe('string');
    // Metadata-only owner change
  const disk = await ensureJsonReadable<{ owner:string; [k:string]:unknown }>(file,6000);
  disk.owner = 'team-y';
  fs.writeFileSync(file, JSON.stringify(disk,null,2));
    await ensureJsonReadable(file,6000);
    // Second call should reflect automatic invalidation without explicit reload
    send(server,{ jsonrpc:'2.0', id:6404, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
    const secondEnv = await getResponse(out,6404,6000);
    const secondPayload = parseToolPayload<{ governanceHash:string; items:GovProjection[] }>(JSON.stringify(secondEnv));
    if(!secondPayload) throw new Error('missing second governanceHash payload');
    const secondHash = secondPayload.governanceHash;
    expect(secondHash).not.toBe(firstHash);
    const firstItem = firstPayload.items.find(i=> i.id===id)!;
    const secondItem = secondPayload.items.find(i=> i.id===id)!;
    expect(firstItem.owner).toBe('team-x');
    expect(secondItem.owner).toBe('team-y');
    server.kill();
  }, 15000);
});
