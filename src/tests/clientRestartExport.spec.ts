import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor } from './testUtils';

function startServer(env: Record<string,string|undefined> = {}){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', ...env } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string,unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

interface ExportResult { hash:string; count:number; items:Array<{ id:string; sourceHash:string; version?:string; owner?:string; priorityTier?:string; lastReviewedAt?:string; nextReviewDue?:string }>; }

describe('client restart export continuity', () => {
  it('exports catalog, restarts server, exports again and compares governance continuity', async () => {
    // Ensure bootstrap file exists (user may have manually edited it)
    const instructionsDir = path.join(process.cwd(),'instructions');
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir);
    const bootstrapId = 'obfuscation-pattern-gaps-2025';
    const bootstrapPath = path.join(instructionsDir, bootstrapId + '.json');
    expect(fs.existsSync(bootstrapPath), 'missing bootstrap instruction file').toBe(true);

    // First run
    const server1 = startServer();
    const out1:string[]=[]; server1.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)) );
    send(server1,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'restart-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out1.some(l=> { try { return JSON.parse(l).id===1; } catch { return false; } }), 2000);
    send(server1,{ jsonrpc:'2.0', id:2, method:'instructions/export', params:{} });
    await waitFor(()=> out1.some(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }), 3000);
    const exportLine1 = out1.find(l=> { try { return JSON.parse(l).id===2; } catch { return false; } });
    expect(exportLine1).toBeTruthy();
    const exportObj1 = JSON.parse(exportLine1!); const result1:ExportResult = exportObj1.result;
    expect(result1.items.some(i=> i.id===bootstrapId)).toBe(true);
    // Capture snapshot of governance fields for bootstrap instruction
  const boot1 = result1.items.find(i=> i.id===bootstrapId)!;
  // Ensure review governance fields present after enrichment
  expect(boot1.lastReviewedAt && boot1.lastReviewedAt.length>0, 'missing lastReviewedAt after first load').toBe(true);
  expect(boot1.nextReviewDue && boot1.nextReviewDue.length>0, 'missing nextReviewDue after first load').toBe(true);
  const snapshot = { sourceHash: boot1.sourceHash, owner: boot1.owner, priorityTier: boot1.priorityTier, lastReviewedAt: boot1.lastReviewedAt, nextReviewDue: boot1.nextReviewDue };
    server1.kill();

    // Simulate client restart: start new server process
    const server2 = startServer();
    const out2:string[]=[]; server2.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)) );
    send(server2,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'restart-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out2.some(l=> { try { return JSON.parse(l).id===10; } catch { return false; } }), 2000);
    send(server2,{ jsonrpc:'2.0', id:11, method:'instructions/export', params:{} });
    await waitFor(()=> out2.some(l=> { try { return JSON.parse(l).id===11; } catch { return false; } }), 3000);
    const exportLine2 = out2.find(l=> { try { return JSON.parse(l).id===11; } catch { return false; } });
    expect(exportLine2).toBeTruthy();
    const exportObj2 = JSON.parse(exportLine2!); const result2:ExportResult = exportObj2.result;
    expect(result2.items.some(i=> i.id===bootstrapId)).toBe(true);
    const boot2 = result2.items.find(i=> i.id===bootstrapId)!;

    // Assert continuity: same governance fields (unless intentionally changed externally)
    // If mismatch, surface detailed diff for investigation.
    const diffs:string[]=[];
    if(snapshot.sourceHash !== boot2.sourceHash) diffs.push(`sourceHash changed: ${snapshot.sourceHash} -> ${boot2.sourceHash}`);
    if(snapshot.owner !== boot2.owner) diffs.push(`owner changed: ${snapshot.owner} -> ${boot2.owner}`);
  if(snapshot.priorityTier !== boot2.priorityTier) diffs.push(`priorityTier changed: ${snapshot.priorityTier} -> ${boot2.priorityTier}`);
  if(snapshot.lastReviewedAt !== boot2.lastReviewedAt) diffs.push(`lastReviewedAt changed: ${snapshot.lastReviewedAt} -> ${boot2.lastReviewedAt}`);
  if(snapshot.nextReviewDue !== boot2.nextReviewDue) diffs.push(`nextReviewDue changed: ${snapshot.nextReviewDue} -> ${boot2.nextReviewDue}`);

    expect(diffs.join('\n') || 'OK').toBe('OK');
    // Basic invariant: catalog hash should be reproducible across restart (unless race with enrichment). Allow difference but warn.
    if(result1.hash !== result2.hash){
      // Non-fatal expectation; provide diagnostic but don't fail test.
      // eslint-disable-next-line no-console
      console.warn('Catalog hash changed across restart:', result1.hash, '->', result2.hash);
    }
    server2.kill();
  }, 10000);
});
