import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
const wait = (ms:number)=> new Promise(r=>setTimeout(r,ms));

const instructionsDir = path.join(process.cwd(),'instructions');
interface GovProjection { id:string; title:string; version:string; owner:string; priorityTier:string; nextReviewDue:string; semanticSummarySha256:string; changeLogLength:number }

describe('governance hash auto invalidation (mtime)', () => {
  it('updates governanceHash after owner metadata change without explicit reload', async () => {
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir);
    const id = 'gov_hash_auto_invalidation';
    const file = path.join(instructionsDir, id + '.json');
    const now = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify({ id, title:'Gov Hash Auto', body:'Stable Body', priority:5, audience:'all', requirement:'mandatory', categories:['auto'], sourceHash:'', schemaVersion:'1', createdAt:now, updatedAt:now, version:'1.0.0', status:'approved', owner:'team-x', priorityTier:'P2', classification:'internal', lastReviewedAt:now, nextReviewDue:now, changeLog:[{version:'1.0.0', changedAt:now, summary:'initial'}], semanticSummary:'Stable Body' },null,2));
    // Ensure distinct mtime window between create and later edit on platforms with coarse resolution
    await wait(1100);
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
  send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> out.some(l=> { try { return JSON.parse(l).id===1; } catch { return false; } }), 3000);
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
  await waitFor(()=> out.some(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }), 3000);
  const firstRespLine = out.find(l=>{ try { const o = JSON.parse(l); return o.id===2; } catch { return false; } });
  expect(firstRespLine).toBeTruthy();
  const firstPayload = firstRespLine? parseToolPayload<{ governanceHash:string; items:GovProjection[] }>(firstRespLine): undefined;
  if(!firstPayload) throw new Error('missing first governanceHash payload');
  const firstHash = firstPayload.governanceHash;
    expect(typeof firstHash).toBe('string');
    // Modify only owner (metadata)
    const disk = JSON.parse(fs.readFileSync(file,'utf8'));
    disk.owner = 'team-y';
    fs.writeFileSync(file, JSON.stringify(disk,null,2));
    // Call governanceHash again WITHOUT reload; auto mtime invalidation should pick it up
  send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
  await waitFor(()=> out.some(l=> { try { return JSON.parse(l).id===3; } catch { return false; } }), 3000);
  const secondRespLine = out.find(l=>{ try { const o = JSON.parse(l); return o.id===3; } catch { return false; } });
  expect(secondRespLine).toBeTruthy();
  const secondPayload = secondRespLine? parseToolPayload<{ governanceHash:string; items:GovProjection[] }>(secondRespLine): undefined;
  if(!secondPayload) throw new Error('missing second governanceHash payload');
  const secondHash = secondPayload.governanceHash;
    expect(secondHash).not.toBe(firstHash);
    // Confirm projection reflects owner change
  const firstItem = firstPayload.items.find(i=> i.id===id)!;
  const secondItem = secondPayload.items.find(i=> i.id===id)!;
    expect(firstItem.owner).toBe('team-x');
    expect(secondItem.owner).toBe('team-y');
    server.kill();
  }, 8000);
});
