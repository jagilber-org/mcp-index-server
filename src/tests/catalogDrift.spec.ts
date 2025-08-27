import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { waitFor, parseToolPayload } from './testUtils';

// Helper to start server with mutation enabled (we only read export, no mutation needed but keep consistent env)
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', MCP_LOG_VERBOSE:'' } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

interface ExportItem { id:string; sourceHash:string; version?:string; body?:string; }

function governanceFingerprint(items: ExportItem[]): string {
  // Mirror governance hash logic approximation: sorted ids + sourceHash + version
  const sorted = items.slice().sort((a,b)=> a.id.localeCompare(b.id));
  const hash = crypto.createHash('sha256');
  for(const e of sorted){ hash.update(e.id+'|'+(e.sourceHash||'')+'|'+(e.version||'')); }
  return hash.digest('hex');
}

describe('catalog drift snapshot vs export', () => {
  it('detects missing / changed items relative to saved snapshot', async () => {
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'drift-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> { try { return JSON.parse(l).id===1; } catch { return false; } }), 1500);
  // Export via tools/call dispatcher
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'export' } } });
    await waitFor(()=> out.some(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }), 2000);
    const exportLine = out.filter(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }).pop();
    expect(exportLine).toBeTruthy();
  const payload = parseToolPayload<{ items:ExportItem[]; hash:string }>(exportLine!);
  expect(payload, 'missing dispatcher export payload').toBeTruthy();
  const items: ExportItem[] = payload!.items as ExportItem[];
    expect(Array.isArray(items)).toBe(true);
  const currentHash = payload!.hash;
    expect(typeof currentHash).toBe('string');
  // Baseline guard: ensure critical bootstrap id present
  const ids = new Set(items.map(i=>i.id));
  expect(ids.has('obfuscation-pattern-gaps-2025')).toBe(true);

    // Build a synthetic snapshot file (simulate previously enriched snapshot) with a deliberate modification for drift
    const snapshotItems = items.slice(0, Math.min(items.length, 5)).map(i=> ({ id:i.id, sourceHash:i.sourceHash, version:i.version }));
    if(snapshotItems.length){ // introduce drift: modify first hash if possible
      snapshotItems[0].sourceHash = 'deadbeef' + snapshotItems[0].sourceHash.slice(8);
    }
    const snapshotPath = path.join(process.cwd(), 'snapshots');
    if(!fs.existsSync(snapshotPath)) fs.mkdirSync(snapshotPath, { recursive:true });
    const snapshotFile = path.join(snapshotPath, 'catalog-snapshot-test.json');
    fs.writeFileSync(snapshotFile, JSON.stringify({ generatedAt:new Date().toISOString(), items: snapshotItems }, null,2));

    // Compute fingerprint for snapshot & export to compare
    const snapshotFingerprint = governanceFingerprint(snapshotItems);
    const exportFingerprint = governanceFingerprint(items);

    // Basic drift computation
    const exportMap = new Map(items.map(i=> [i.id,i] as const));
    const missing: string[] = [];
    const changed: string[] = [];
    for(const s of snapshotItems){
      const live = exportMap.get(s.id);
      if(!live) missing.push(s.id); else if(live.sourceHash !== s.sourceHash) changed.push(s.id);
    }

    // Expectations: either missing or changed (we forced a change if any item exists)
    if(snapshotItems.length){
      expect(changed.length + missing.length).toBeGreaterThan(0);
      expect(changed[0]).toBe(snapshotItems[0].id); // first one altered
    }

    // Fingerprints should differ when drift introduced
    if(snapshotItems.length){
      expect(snapshotFingerprint).not.toBe(exportFingerprint);
    }

    server.kill();
  }, 10000);
});
