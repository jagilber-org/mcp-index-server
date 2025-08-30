import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(env: Record<string,string|undefined> = {}){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', ...env } });
}

/**
 * Create an isolated instructions directory seeded with the bootstrap file so
 * restart hash tests are not affected by concurrent suites adding instructions.
 */
function makeIsolatedInstructionsDir(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-restart-'));
  const realDir = path.join(process.cwd(), 'instructions');
  const bootstrap = 'obfuscation-pattern-gaps-2025.json';
  const src = path.join(realDir, bootstrap);
  if(!fs.existsSync(src)) throw new Error('missing bootstrap instruction file at '+src);
  fs.mkdirSync(base, { recursive: true });
  fs.copyFileSync(src, path.join(base, bootstrap));
  return base;
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string,unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function haveId(lines:string[], id:number){ return lines.some(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }); }

interface ExportResult { hash:string; count:number; items:Array<{ id:string; sourceHash:string; version?:string; owner?:string; priorityTier?:string; lastReviewedAt?:string; nextReviewDue?:string }>; }

describe('client restart export continuity', () => {
  it('exports catalog, restarts server (isolated dir) and compares governance continuity deterministically', async () => {
    const isolatedDir = makeIsolatedInstructionsDir();
    const bootstrapId = 'obfuscation-pattern-gaps-2025';

    // First run
  const server1 = startServer({ INSTRUCTIONS_DIR: isolatedDir });
    const out1:string[]=[]; server1.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)) );
  send(server1,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'restart-test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out1,1), 2000);
  send(server1,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'export' } } });
  await waitFor(()=> haveId(out1,2), 3000);
  const exportLine1 = findLine(out1,2);
  expect(exportLine1, 'missing export line 1').toBeTruthy();
  const result1 = exportLine1? parseToolPayload<ExportResult>(exportLine1) : undefined;
  if(!result1) throw new Error('missing export result1 (parseToolPayload returned undefined)');
  expect(result1.items.some(i=> i.id===bootstrapId)).toBe(true);
    // Capture snapshot of governance fields for bootstrap instruction
  const boot1 = result1.items.find(i=> i.id===bootstrapId)!;
  // Ensure review governance fields present after enrichment
  expect(boot1.lastReviewedAt && boot1.lastReviewedAt.length>0, 'missing lastReviewedAt after first load').toBe(true);
  expect(boot1.nextReviewDue && boot1.nextReviewDue.length>0, 'missing nextReviewDue after first load').toBe(true);
  const snapshot = { sourceHash: boot1.sourceHash, owner: boot1.owner, priorityTier: boot1.priorityTier, lastReviewedAt: boot1.lastReviewedAt, nextReviewDue: boot1.nextReviewDue };
    server1.kill();

    // Simulate client restart: start new server process
  const server2 = startServer({ INSTRUCTIONS_DIR: isolatedDir });
    const out2:string[]=[]; server2.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)) );
  send(server2,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'restart-test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out2,10), 2000);
  send(server2,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'export' } } });
  await waitFor(()=> haveId(out2,11), 3000);
  const exportLine2 = findLine(out2,11);
  expect(exportLine2, 'missing export line 2').toBeTruthy();
  const result2 = exportLine2? parseToolPayload<ExportResult>(exportLine2) : undefined;
  if(!result2) throw new Error('missing export result2 (parseToolPayload returned undefined)');
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
  // With isolation the catalog hash SHOULD match exactly; enforce it now.
  expect(result1.hash).toBe(result2.hash);
    server2.kill();
  // Cleanup isolated directory (best-effort; ignore errors on Windows locks)
  try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, 10000);
});
