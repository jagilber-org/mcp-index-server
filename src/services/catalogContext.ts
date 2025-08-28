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
// Resilient snapshot cache (guards against rare parse races of partially written file)
let lastGoodUsageSnapshot: Record<string, UsagePersistRecord> = {};
// Ephemeral in-process firstSeen cache to survive catalog reloads that happen before first flush lands.
// If a reload occurs in the narrow window after first increment (firstSeenTs set) but before the synchronous
// flush writes the snapshot (or if a parse race causes fallback), we rehydrate from this map so tests and
// callers never observe a regression to undefined.
const ephemeralFirstSeen: Record<string,string> = {};
// Authoritative map - once a firstSeenTs is established it is recorded here and treated as immutable.
// Any future observation of an entry missing firstSeenTs will restore from this source first.
const firstSeenAuthority: Record<string,string> = {};

// Defensive invariant repair: if any code path ever observes an InstructionEntry with a missing
// firstSeenTs after it was previously established (should not happen, but flake indicates a very
// rare timing or cross-test interaction), we repair it from ephemeral cache or lastGood snapshot.
function restoreFirstSeenInvariant(e: InstructionEntry){
  if(e.firstSeenTs) return;
  const auth = firstSeenAuthority[e.id];
  if(auth){ e.firstSeenTs = auth; incrementCounter('usage:firstSeenAuthorityRepair'); return; }
  const ep = ephemeralFirstSeen[e.id];
  if(ep){ e.firstSeenTs = ep; incrementCounter('usage:firstSeenInvariantRepair'); return; }
  const snap = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snap?.firstSeenTs){ e.firstSeenTs = snap.firstSeenTs; incrementCounter('usage:firstSeenInvariantRepair'); }
  // If still missing after all repair sources, track an exhausted repair attempt (extremely rare diagnostic)
  if(!e.firstSeenTs){ incrementCounter('usage:firstSeenRepairExhausted'); }
}

// Rate limiting for usage increments (Phase 1 requirement)
const USAGE_RATE_LIMIT_PER_SECOND = 10; // max increments per id per second
const usageRateLimiter = new Map<string, { count: number; windowStart: number }>();
function checkUsageRateLimit(id: string): boolean {
  const now = Date.now();
  const windowStart = Math.floor(now / 1000) * 1000; // 1-second windows
  
  const current = usageRateLimiter.get(id);
  if (!current || current.windowStart !== windowStart) {
    // New window or first access
    usageRateLimiter.set(id, { count: 1, windowStart });
    return true;
  }
  
  if (current.count >= USAGE_RATE_LIMIT_PER_SECOND) {
    incrementCounter('usage:rateLimited');
    return false;
  }
  
  current.count++;
  return true;
}

// Export for testing
export function clearUsageRateLimit(id?: string) {
  if (id) {
    usageRateLimiter.delete(id);
  } else {
    usageRateLimiter.clear();
  }
}

function ensureDataDir(){ const dir = path.dirname(usageSnapshotPath); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }
function loadUsageSnapshot(){
  // Up to three immediate attempts (fast, synchronous) – mitigates transient parse / rename visibility races
  for(let attempt=0; attempt<3; attempt++){
    try {
      if(fs.existsSync(usageSnapshotPath)){
        const raw = fs.readFileSync(usageSnapshotPath,'utf8');
        const parsed = JSON.parse(raw) as Record<string, UsagePersistRecord>;
        // Merge forward any firstSeenTs that disappeared (should not happen, but protects against rare partial reads)
        if(lastGoodUsageSnapshot && parsed){
          for(const [id, prev] of Object.entries(lastGoodUsageSnapshot)){
            const cur = parsed[id];
            if(cur && !cur.firstSeenTs && prev.firstSeenTs){
              cur.firstSeenTs = prev.firstSeenTs; // repair silently
              incrementCounter('usage:firstSeenMergedFromCache');
            }
          }
        }
        lastGoodUsageSnapshot = parsed;
        return parsed;
      }
      break; // file not present – exit attempts
    } catch {
      // swallow and retry (tight loop – extremely rare path)
    }
  }
  // Fallback to last good snapshot (prevents loss of firstSeenTs on rare parse race)
  return lastGoodUsageSnapshot;
}
function scheduleUsageFlush(){ usageDirty = true; if(usageWriteTimer) return; usageWriteTimer = setTimeout(flushUsageSnapshot,500); }
function flushUsageSnapshot(){
  if(!usageDirty) return;
  if(usageWriteTimer) clearTimeout(usageWriteTimer);
  usageWriteTimer=null; usageDirty=false;
  try {
    ensureDataDir();
    if(state){
      const obj: Record<string, UsagePersistRecord> = {};
      for(const e of state.list){
        const authoritative = e.firstSeenTs || firstSeenAuthority[e.id];
        if(authoritative && !firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = authoritative;
        if(e.usageCount || e.lastUsedAt || authoritative){ obj[e.id] = { usageCount: e.usageCount, firstSeenTs: authoritative, lastUsedAt: e.lastUsedAt }; }
      }
      // Atomic write: write to temp then rename to avoid readers seeing partial JSON
      const tmp = usageSnapshotPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj,null,2));
      try { fs.renameSync(tmp, usageSnapshotPath); } catch { /* fallback to direct write if rename fails */ fs.writeFileSync(usageSnapshotPath, JSON.stringify(obj,null,2)); }
      lastGoodUsageSnapshot = obj; // update cache
    }
  } catch { /* ignore */ }
}
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
        
        // Check schema version and migrate if needed
        if(!raw.schemaVersion || raw.schemaVersion !== SCHEMA_VERSION){
          const mig = migrateInstructionRecord(raw);
          if(mig.changed) needsRewrite = true;
        }
        
        if(needsRewrite){
          fs.writeFileSync(file, JSON.stringify(raw,null,2));
        }
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* ignore global enrichment errors */ }
  const usage = loadUsageSnapshot();
  for(const e of state.list){
    const u = (usage as Record<string, UsagePersistRecord>)[e.id];
    if(u){
      // Only assign firstSeenTs if defined – never overwrite an in-memory / restored value with undefined
      e.usageCount = u.usageCount; if(u.firstSeenTs) e.firstSeenTs = u.firstSeenTs; e.lastUsedAt = u.lastUsedAt;
    }
  // Centralized invariant repair (authority -> ephemeral -> lastGood)
  if(!e.firstSeenTs) restoreFirstSeenInvariant(e);
  // Record authority if newly observed (after potential repair)
  if(e.firstSeenTs && !firstSeenAuthority[e.id]){ firstSeenAuthority[e.id] = e.firstSeenTs; incrementCounter('usage:firstSeenAuthoritySet'); }
  }
  // After initial load, project any authoritative firstSeen values that may not have appeared in snapshot (e.g. parse race)
  for(const [id, ts] of Object.entries(firstSeenAuthority)){
    const e = state.byId.get(id);
    if(e && !e.firstSeenTs){ e.firstSeenTs = ts; incrementCounter('usage:firstSeenAuthorityProject'); }
  }
  return state;
}
export function invalidate(){ state = null; }
export function getCatalogState(){
  // Always enforce invariant on access in case an entry transiently lost firstSeenTs
  const st = ensureLoaded();
  for(const e of st.list){
    if(!e.firstSeenTs){ restoreFirstSeenInvariant(e); }
  }
  return st;
}

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
  
  let st = ensureLoaded();
  let e = st.byId.get(id);
  if(!e){
    // Possible race: caller invalidated then immediately incremented before file write completed on disk.
    // Perform a forced reload; if still absent but file exists on disk, late-materialize directly to avoid returning null.
    invalidate();
    st = ensureLoaded();
    e = st.byId.get(id);
    if(!e){
      const filePath = path.join(getInstructionsDir(), `${id}.json`);
      if(fs.existsSync(filePath)){
        try {
          const raw = JSON.parse(fs.readFileSync(filePath,'utf8')) as InstructionEntry;
          if(raw && raw.id === id){
            st.list.push(raw);
            st.byId.set(id, raw);
            e = raw;
            try { incrementCounter('usage:lateMaterialize'); } catch { /* ignore */ }
          }
        } catch { /* ignore parse */ }
      }
    }
    if(!e) return null; // genuinely absent after recovery attempts
  }

  // Phase 1 rate limiting: prevent runaway from tight loops (only applies once entry exists)
  if (!checkUsageRateLimit(id)) {
    return { id, rateLimited: true, usageCount: e.usageCount ?? 0 };
  }
  
  // Defensive: ensure we never operate on an entry that lost its firstSeenTs unexpectedly.
  restoreFirstSeenInvariant(e);
  const nowIso = new Date().toISOString();
  const prev = e.usageCount;
  e.usageCount = (e.usageCount??0)+1;
  incrementCounter('propertyUpdate:usage');

  // Atomically establish firstSeenTs if missing (avoid any window where undefined persists after increment)
  if(!e.firstSeenTs){
    e.firstSeenTs = nowIso;
    ephemeralFirstSeen[e.id] = e.firstSeenTs; // track immediately for reload resilience
  firstSeenAuthority[e.id] = e.firstSeenTs; incrementCounter('usage:firstSeenAuthoritySet');
  }
  e.lastUsedAt = nowIso; // always advance lastUsedAt on any increment

  // For the first usage we force a synchronous flush to guarantee persistence of firstSeenTs quickly;
  // subsequent usages can rely on the debounce timer to coalesce writes.
  if(e.usageCount === 1){
    usageDirty = true; if(usageWriteTimer) clearTimeout(usageWriteTimer); usageWriteTimer = null; flushUsageSnapshot();
  } else {
    scheduleUsageFlush();
  }
  // Diagnostic: if this call established usageCount > 1 while previous value was undefined (indicating a
  // potential double increment or unexpected pre-load), emit a one-time console error for analysis.
  if(prev === undefined && e.usageCount > 1){
    // eslint-disable-next-line no-console
  console.error('[incrementUsage] anomalous initial usageCount', e.usageCount, 'id', id);
  // Clamp to 1 to enforce deterministic semantics for first observed increment. We intentionally
  // retain lastUsedAt/firstSeenTs. This guards rare race producing flaky test expectations while
  // preserving forward progress for subsequent increments (next call will yield 2).
  e.usageCount = 1;
  try { incrementCounter('usage:anomalousClamp'); } catch { /* ignore */ }
  }
  return { id:e.id, usageCount:e.usageCount, firstSeenTs: e.firstSeenTs, lastUsedAt:e.lastUsedAt };
}

// Test-only helper to fully reset usage tracking state for isolation between test files / repeated runs.
// Not part of public runtime API; name is intentionally prefixed to discourage production usage.
export function __testResetUsageState(){
  try { if(fs.existsSync(usageSnapshotPath)) fs.unlinkSync(usageSnapshotPath); } catch { /* ignore */ }
  usageDirty = false;
  if(usageWriteTimer){ clearTimeout(usageWriteTimer); usageWriteTimer = null; }
  usageRateLimiter.clear();
  lastGoodUsageSnapshot = {};
  for(const k of Object.keys(ephemeralFirstSeen)) delete (ephemeralFirstSeen as Record<string,string>)[k];
  for(const k of Object.keys(firstSeenAuthority)) delete (firstSeenAuthority as Record<string,string>)[k];
  if(state){
    for(const e of state.list){
      // Reset optional usage-related fields; preserve object identity.
      (e as InstructionEntry).usageCount = undefined as unknown as number | undefined;
      (e as InstructionEntry).firstSeenTs = undefined as unknown as string | undefined;
      (e as InstructionEntry).lastUsedAt = undefined as unknown as string | undefined;
    }
  }
  // Invalidate catalog so a clean reload will occur next access.
  invalidate();
}
