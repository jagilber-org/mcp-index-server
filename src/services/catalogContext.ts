import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CatalogLoader } from './catalogLoader';
import { InstructionEntry } from '../models/instruction';
import { hasFeature, incrementCounter } from './features';
import { atomicWriteJson } from './atomicFs';
import { ClassificationService } from './classificationService';
import { SCHEMA_VERSION, migrateInstructionRecord } from '../versioning/schemaVersion';
import { resolveOwner } from './ownershipService';

export interface CatalogState { loadedAt: string; hash: string; byId: Map<string, InstructionEntry>; list: InstructionEntry[]; latestMTime: number; fileSignature: string; fileCount: number; versionMTime: number }
let state: CatalogState | null = null;

// Usage snapshot persistence (shared)
const usageSnapshotPath = path.join(process.cwd(),'data','usage-snapshot.json');
interface UsagePersistRecord { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string }
let usageDirty = false; let usageWriteTimer: NodeJS.Timeout | null = null;
function ensureDataDir(){ const dir = path.dirname(usageSnapshotPath); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }
function loadUsageSnapshot(){ try { if(fs.existsSync(usageSnapshotPath)) return JSON.parse(fs.readFileSync(usageSnapshotPath,'utf8')); } catch { /* ignore */ } return {}; }
function scheduleUsageFlush(){ usageDirty = true; if(usageWriteTimer) return; usageWriteTimer = setTimeout(flushUsageSnapshot,500); }
function flushUsageSnapshot(){ if(!usageDirty) return; if(usageWriteTimer) clearTimeout(usageWriteTimer); usageWriteTimer=null; usageDirty=false; try { ensureDataDir(); if(state){ const obj: Record<string, UsagePersistRecord> = {}; for(const e of state.list){ if(e.usageCount || e.lastUsedAt || e.firstSeenTs){ obj[e.id] = { usageCount: e.usageCount, firstSeenTs: e.firstSeenTs, lastUsedAt: e.lastUsedAt }; } } fs.writeFileSync(usageSnapshotPath, JSON.stringify(obj,null,2)); } } catch {/* ignore */} }
process.on('SIGINT', ()=>{ flushUsageSnapshot(); process.exit(0); });
process.on('SIGTERM', ()=>{ flushUsageSnapshot(); process.exit(0); });
process.on('beforeExit', ()=>{ flushUsageSnapshot(); });

// Single pinned instructions directory for deterministic load/write.
// Priority: env INSTRUCTIONS_DIR if set -> process.cwd()/instructions
const PINNED_INSTRUCTIONS_DIR = (() => {
  const raw = process.env.INSTRUCTIONS_DIR;
  const resolved = raw ? path.resolve(raw) : path.join(process.cwd(),'instructions');
  if(!fs.existsSync(resolved)){
    try { fs.mkdirSync(resolved,{recursive:true}); } catch {/* ignore */}
  }
  return resolved;
})();
export function getInstructionsDir(){ return PINNED_INSTRUCTIONS_DIR; }
// Lightweight diagnostics for external callers (startup logging / health checks)
export function diagnoseInstructionsDir(){
  const dir = getInstructionsDir();
  let exists = false; let writable = false; let error: string | null = null;
  try {
    exists = fs.existsSync(dir);
    if(exists){
      // attempt a tiny write to check permissions (guard against sandbox / readonly mounts)
      const probe = path.join(dir, `.wprobe-${Date.now()}.tmp`);
      try { fs.writeFileSync(probe, 'ok'); writable = true; fs.unlinkSync(probe); } catch(w){ writable = false; error = (w as Error).message; }
    }
  } catch(e){ error = (e as Error).message; }
  return { dir, exists, writable, error };
}
interface DirMeta { latest:number; signature:string; count:number }
function computeDirMeta(dir: string): DirMeta {
  const parts: string[] = [];
  let latest = 0; let count = 0; const now = Date.now();
  try {
    for(const f of fs.readdirSync(dir)){
      if(!f.endsWith('.json')) continue;
      const fp = path.join(dir,f);
      try { const st = fs.statSync(fp); if(!st.isFile()) continue; count++; const effMtime = Math.min(st.mtimeMs, now); latest = Math.max(latest, effMtime); parts.push(`${f}:${st.mtimeMs}:${st.size}`); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  parts.sort(); const h = crypto.createHash('sha256'); h.update(parts.join('|'),'utf8');
  const signature = h.digest('hex');
  return { latest, signature, count };
}

// Simple explicit version marker file touched on every mutation for robust cross-process cache invalidation.
function getVersionFile(){ return path.join(getInstructionsDir(), '.catalog-version'); }
export function touchCatalogVersion(){ try { fs.writeFileSync(getVersionFile(), Date.now().toString()); } catch { /* ignore */ } }
function readVersionMTime(): number { try { const vf=getVersionFile(); if(fs.existsSync(vf)){ return fs.statSync(vf).mtimeMs; } } catch { /* ignore */ } return 0; }
export function ensureLoaded(): CatalogState {
  const baseDir = getInstructionsDir();
  // Optional escape hatch: disable caching completely for deterministic multi-process CRUD (tests / debug)
  if(process.env.INSTRUCTIONS_ALWAYS_RELOAD === '1') state = null;
  if(state){
    const meta = computeDirMeta(baseDir);
    const verM = readVersionMTime();
    if(verM > state.versionMTime || meta.latest > state.latestMTime || meta.signature !== state.fileSignature || meta.count !== state.fileCount){ state = null; }
  }
  if(state) return state;
  const loader = new CatalogLoader(baseDir);
  const result = loader.load();
  const byId = new Map<string, InstructionEntry>(); result.entries.forEach(e=>byId.set(e.id,e));
  const meta = computeDirMeta(baseDir);
  const versionMTime = readVersionMTime();
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: result.entries, latestMTime: meta.latest, fileSignature: meta.signature, fileCount: meta.count, versionMTime };
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
          ['semanticSummary', v => (!(typeof v === 'string' && v.length>0)) && !!entry.semanticSummary, entry.semanticSummary],
          // Stabilize governance projection fields across restarts by persisting once materialized
          ['lastReviewedAt', v => !(typeof v === 'string' && v.length>0) && !!entry.lastReviewedAt, entry.lastReviewedAt],
          ['nextReviewDue', v => !(typeof v === 'string' && v.length>0) && !!entry.nextReviewDue, entry.nextReviewDue]
        ];
        for(const [k,isPh,val] of placeholders){ if(isPh(raw[k])){ raw[k]=val; needsRewrite = true; } }
        // Normalize changeLog changedAt placeholders if present
  // changeLog placeholder normalization no longer needed (optional fields)
        if(needsRewrite){
          // Preserve other raw fields, ensure schemaVersion exists
          if(!raw.schemaVersion || raw.schemaVersion !== SCHEMA_VERSION){
            const mig = migrateInstructionRecord(raw);
            if(mig.changed) needsRewrite = true;
          }
          fs.writeFileSync(file, JSON.stringify(raw,null,2));
        }
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* ignore global enrichment errors */ }
  const usage = loadUsageSnapshot();
  for(const e of state.list){ const u = (usage as Record<string, UsagePersistRecord>)[e.id]; if(u){ e.usageCount = u.usageCount; e.firstSeenTs = u.firstSeenTs; e.lastUsedAt = u.lastUsedAt; } }
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
  // Optional deterministic stabilization: if env set, ensure stable newline termination and explicit sorting already applied
  const lines = entries.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(e=> JSON.stringify(projectGovernance(e)));
  if(process.env.GOV_HASH_TRAILING_NEWLINE === '1'){ lines.push(''); }
  h.update(lines.join('\n'),'utf8');
  return h.digest('hex');
}

// Mutation helpers (import/add/remove/groom share)
export function writeEntry(entry: InstructionEntry){
  const file = path.join(getInstructionsDir(), `${entry.id}.json`);
  const classifier = new ClassificationService();
  const record = classifier.normalize(entry);
  if(record.owner === 'unowned'){ const auto = resolveOwner(record.id); if(auto){ record.owner = auto; record.updatedAt = new Date().toISOString(); } }
  atomicWriteJson(file, record);
}
export function removeEntry(id:string){
  const file = path.join(getInstructionsDir(), `${id}.json`);
  if(fs.existsSync(file)) fs.unlinkSync(file);
}
export function scheduleUsagePersist(){ scheduleUsageFlush(); }
export function incrementUsage(id:string){
  if(!hasFeature('usage')){ incrementCounter('usage:gated'); return { featureDisabled:true }; }
  const st = ensureLoaded();
  const e = st.byId.get(id);
  if(!e) return null;
  const nowIso = new Date().toISOString();
  e.usageCount = (e.usageCount??0)+1;
  incrementCounter('propertyUpdate:usage');

  // Atomically establish firstSeenTs if missing (avoid any window where undefined persists after increment)
  if(!e.firstSeenTs) e.firstSeenTs = nowIso;
  e.lastUsedAt = nowIso; // always advance lastUsedAt on any increment

  // For the first usage we force a synchronous flush to guarantee persistence of firstSeenTs quickly;
  // subsequent usages can rely on the debounce timer to coalesce writes.
  if(e.usageCount === 1){
    usageDirty = true; if(usageWriteTimer) clearTimeout(usageWriteTimer); usageWriteTimer = null; flushUsageSnapshot();
  } else {
    scheduleUsageFlush();
  }
  return { id:e.id, usageCount:e.usageCount, firstSeenTs: e.firstSeenTs, lastUsedAt:e.lastUsedAt };
}
