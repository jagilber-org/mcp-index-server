import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
const wait = (ms:number)=> new Promise(r=>setTimeout(r,ms));
async function waitForLine(arr:string[], predicate:(l:string)=>boolean, timeout=2000, interval=30){
  const start = Date.now();
  while(Date.now() - start < timeout){
    const line = arr.find(predicate);
    if(line) return line;
    await wait(interval);
  }
  return undefined;
}

const instructionsDir = path.join(process.cwd(),'instructions');

interface GovProjection { id:string; title:string; version:string; owner:string; priorityTier:string; nextReviewDue:string; semanticSummarySha256:string; changeLogLength:number }

describe('instructions/governanceHash tool', () => {
  it('detects governance drift (owner change) without body change', async () => {
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir);
    const id = 'gov_hash_sample';
    const file = path.join(instructionsDir, id + '.json');
    const now = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify({ id, title:'Gov Hash Sample', body:'Body Stable', priority:10, audience:'all', requirement:'mandatory', categories:['x'], sourceHash:'', schemaVersion:'1', createdAt:now, updatedAt:now, version:'1.0.0', status:'approved', owner:'team-a', priorityTier:'P1', classification:'internal', lastReviewedAt:now, nextReviewDue:now, changeLog:[{version:'1.0.0', changedAt:now, summary:'initial'}], semanticSummary:'Body Stable' },null,2));
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
  await wait(140);
  send(server,{ jsonrpc:'2.0', id:2, method:'instructions/governanceHash', params:{} });
  const firstRespLine = await waitForLine(out, l=>{ try { const o = JSON.parse(l); return o.id===2; } catch { return false; } });
  expect(firstRespLine, 'timeout waiting for first governanceHash response').toBeTruthy();
    const firstObj = JSON.parse(firstRespLine!);
    const firstHash = firstObj.result.governanceHash;
    expect(typeof firstHash).toBe('string');
    // Change only owner in file directly
    const disk = JSON.parse(fs.readFileSync(file,'utf8'));
    disk.owner = 'team-b';
    fs.writeFileSync(file, JSON.stringify(disk,null,2));
    // Reload to pick up change
  send(server,{ jsonrpc:'2.0', id:3, method:'instructions/reload', params:{} });
  await wait(50); // brief delay before reload reply processed
  send(server,{ jsonrpc:'2.0', id:4, method:'instructions/governanceHash', params:{} });
  const secondRespLine = await waitForLine(out, l=>{ try { const o = JSON.parse(l); return o.id===4; } catch { return false; } });
  expect(secondRespLine, 'timeout waiting for second governanceHash response').toBeTruthy();
  const secondObj = JSON.parse(secondRespLine!);
  // Extract projection items to verify owner actually changed
  const firstItems = firstObj.result.items;
  const secondItems = secondObj.result.items;
  const firstProj = (firstItems as GovProjection[]).find(x=> x.id===id)!;
  const secondProj = (secondItems as GovProjection[]).find(x=> x.id===id)!;
  expect(firstProj).toBeTruthy();
  expect(secondProj).toBeTruthy();
  // Owners should differ
  // We cannot see owner directly in projection (owner included) so confirm difference
  expect(firstProj.owner).toBe('team-a');
  expect(secondProj.owner).toBe('team-b');
    const secondHash = secondObj.result.governanceHash;
    // Governance hash should differ after owner change
    expect(secondHash).not.toBe(firstHash);
    server.kill();
  }, 8000);
});
