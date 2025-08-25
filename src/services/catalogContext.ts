import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CatalogLoader } from './catalogLoader';
import { InstructionEntry } from '../models/instruction';
import { atomicWriteJson } from './atomicFs';
import { ClassificationService } from './classificationService';
import { resolveOwner } from './ownershipService';

export interface CatalogState { loadedAt: string; hash: string; byId: Map<string, InstructionEntry>; list: InstructionEntry[]; latestMTime: number }
let state: CatalogState | null = null;

// Usage snapshot persistence (shared)
const usageSnapshotPath = path.join(process.cwd(),'data','usage-snapshot.json');
interface UsagePersistRecord { usageCount?: number; lastUsedAt?: string }
let usageDirty = false; let usageWriteTimer: NodeJS.Timeout | null = null;
function ensureDataDir(){ const dir = path.dirname(usageSnapshotPath); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }
function loadUsageSnapshot(){ try { if(fs.existsSync(usageSnapshotPath)) return JSON.parse(fs.readFileSync(usageSnapshotPath,'utf8')); } catch { /* ignore */ } return {}; }
function scheduleUsageFlush(){ usageDirty = true; if(usageWriteTimer) return; usageWriteTimer = setTimeout(flushUsageSnapshot,500); }
function flushUsageSnapshot(){ if(!usageDirty) return; if(usageWriteTimer) clearTimeout(usageWriteTimer); usageWriteTimer=null; usageDirty=false; try { ensureDataDir(); if(state){ const obj: Record<string, UsagePersistRecord> = {}; for(const e of state.list){ if(e.usageCount || e.lastUsedAt){ obj[e.id] = { usageCount: e.usageCount, lastUsedAt: e.lastUsedAt }; } } fs.writeFileSync(usageSnapshotPath, JSON.stringify(obj,null,2)); } } catch {/* ignore */} }
process.on('SIGINT', ()=>{ flushUsageSnapshot(); process.exit(0); });
process.on('SIGTERM', ()=>{ flushUsageSnapshot(); process.exit(0); });
process.on('beforeExit', ()=>{ flushUsageSnapshot(); });

function resolveInstructionsDir(): string {
  const candidates = [
    path.join(process.cwd(),'instructions'),
    path.join(__dirname,'..','..','instructions'),
    path.join(process.cwd(),'..','instructions')
  ];
  for(const c of candidates){ try { if(fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return candidates[0];
}
function computeLatestMTime(dir: string){
  let latest = 0; try { for(const f of fs.readdirSync(dir)){ if(!f.endsWith('.json')) continue; const fp = path.join(dir,f); try { const st = fs.statSync(fp); if(st.isFile()) latest = Math.max(latest, st.mtimeMs); } catch { /* ignore */ } } } catch { /* ignore */ }
  return latest;
}
export function ensureLoaded(): CatalogState {
  const baseDir = resolveInstructionsDir();
  if(state){ const latest = computeLatestMTime(baseDir); if(latest > state.latestMTime) state = null; }
  if(state) return state;
  const loader = new CatalogLoader(baseDir);
  const result = loader.load();
  const byId = new Map<string, InstructionEntry>(); result.entries.forEach(e=>byId.set(e.id,e));
  const latestMTime = computeLatestMTime(baseDir);
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: result.entries, latestMTime };
  // Automatic enrichment persistence pass (startup). If a file contains placeholder governance fields that were
  // normalized in-memory (e.g. empty sourceHash, createdAt/updatedAt timestamps, owner auto-resolution, semanticSummary hash)
  // we rewrite that file once so subsequent processes / drift checks see consistent data on disk.
  try {
    for(const entry of state.list){
      const file = path.join(baseDir, `${entry.id}.json`);
      if(!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file,'utf8')) as Record<string, unknown>;
        let needsRewrite = false;
        // Fields to project & compare (only treat placeholder → enriched transitions)
        const placeholders: [key: string, isPlaceholder: (v: unknown)=>boolean, value: unknown][] = [
          ['sourceHash', v => !(typeof v === 'string' && v.length>0), entry.sourceHash],
          ['owner', v => v === 'unowned' && !!(entry.owner && entry.owner !== 'unowned'), entry.owner],
          ['semanticSummary', v => (!(typeof v === 'string' && v.length>0)) && !!entry.semanticSummary, entry.semanticSummary]
        ];
        for(const [k,isPh,val] of placeholders){ if(isPh(raw[k])){ raw[k]=val; needsRewrite = true; } }
        // Normalize changeLog changedAt placeholders if present
  // changeLog placeholder normalization no longer needed (optional fields)
        if(needsRewrite){
          // Preserve other raw fields, ensure schemaVersion exists
          if(!raw.schemaVersion) raw.schemaVersion = (entry as InstructionEntry).schemaVersion || '1';
          fs.writeFileSync(file, JSON.stringify(raw,null,2));
        }
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* ignore global enrichment errors */ }
  const usage = loadUsageSnapshot();
  for(const e of state.list){ const u = (usage as Record<string, UsagePersistRecord>)[e.id]; if(u){ e.usageCount = u.usageCount; e.lastUsedAt = u.lastUsedAt; } }
  return state;
}
export function invalidate(){ state = null; }
export function getCatalogState(){ return ensureLoaded(); }

// Governance projection & hash
export function projectGovernance(e: InstructionEntry){
  return { id:e.id, title:e.title, version: e.version||'1.0.0', owner: e.owner||'unowned', priorityTier: e.priorityTier||'P4', nextReviewDue: e.nextReviewDue||'', semanticSummarySha256: crypto.createHash('sha256').update(e.semanticSummary||'','utf8').digest('hex'), changeLogLength: Array.isArray(e.changeLog)? e.changeLog.length:0 };
}
export function computeGovernanceHash(entries: InstructionEntry[]): string {
  const h = crypto.createHash('sha256');
  const lines = entries.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(e=> JSON.stringify(projectGovernance(e)));
  h.update(lines.join('\n'),'utf8');
  return h.digest('hex');
}

// Mutation helpers (import/add/remove/groom share)
export function writeEntry(entry: InstructionEntry){
  const file = path.join(process.cwd(),'instructions', `${entry.id}.json`);
  const classifier = new ClassificationService();
  const record = classifier.normalize(entry);
  if(record.owner === 'unowned'){ const auto = resolveOwner(record.id); if(auto){ record.owner = auto; record.updatedAt = new Date().toISOString(); } }
  atomicWriteJson(file, record);
}
export function removeEntry(id:string){
  const file = path.join(process.cwd(),'instructions', `${id}.json`);
  if(fs.existsSync(file)) fs.unlinkSync(file);
}
export function scheduleUsagePersist(){ scheduleUsageFlush(); }
export function incrementUsage(id:string){ const st = ensureLoaded(); const e = st.byId.get(id); if(!e) return null; e.usageCount = (e.usageCount??0)+1; e.lastUsedAt = new Date().toISOString(); scheduleUsageFlush(); return { id:e.id, usageCount:e.usageCount, lastUsedAt:e.lastUsedAt }; }
