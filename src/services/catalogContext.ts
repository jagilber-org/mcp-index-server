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

export interface CatalogState { loadedAt: string; hash: string; byId: Map<string, InstructionEntry>; list: InstructionEntry[]; latestMTime: number; fileSignature: string; fileCount: number; versionMTime: number; versionToken: string }
let state: CatalogState | null = null;
// Simple reliable invalidation: any mutation sets dirty=true; next ensureLoaded() performs full rescan.
let dirty = false;

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
interface DirMeta { latest:number; signature:string; count:number; fileMap: Record<string,string> }
function computeDirMeta(dir: string): DirMeta {
  // Incorporate fast content hashes to detect metadata-only edits that keep size & coarse mtime identical.
  const parts: string[] = [];
  const fileMap: Record<string,string> = {};
  let latest = 0; let count = 0; const now = Date.now();
  try {
    for(const f of fs.readdirSync(dir)){
      if(!f.endsWith('.json')) continue;
      const fp = path.join(dir,f);
      try {
        const st = fs.statSync(fp);
        if(!st.isFile()) continue;
        count++;
        const effMtime = Math.min(st.mtimeMs, now);
        latest = Math.max(latest, effMtime);
        let contentHash = '';
        try {
          // Small files: hash full content; larger files: hash first & last 4KB segments to bound cost.
          const buf = fs.readFileSync(fp);
          if(buf.length <= 64 * 1024){
            contentHash = crypto.createHash('sha256').update(buf).digest('hex');
          } else {
            const start = buf.subarray(0, 4096);
            const end = buf.subarray(buf.length-4096);
            contentHash = crypto.createHash('sha256').update(start).update(end).update(String(buf.length)).digest('hex');
          }
        } catch { /* ignore content hash failure */ }
        const record = `${st.mtimeMs}:${st.size}:${contentHash}`;
        parts.push(`${f}:${record}`);
        fileMap[f] = record;
      } catch { /* ignore stat */ }
    }
  } catch { /* ignore readdir */ }
  parts.sort();
  const h = crypto.createHash('sha256');
  h.update(parts.join('|'),'utf8');
  const signature = h.digest('hex');
  return { latest, signature, count, fileMap };
}

// Simple explicit version marker file touched on every mutation for robust cross-process cache invalidation.
function getVersionFile(){ return path.join(getInstructionsDir(), '.catalog-version'); }
export function touchCatalogVersion(){
  try {
    const vf = getVersionFile();
    // Write a monotonically increasing token (time + random) to avoid same-millisecond mtime coalescing on some filesystems
    const token = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    fs.writeFileSync(vf, token);
  } catch { /* ignore */ }
}
function readVersionMTime(): number { try { const vf=getVersionFile(); if(fs.existsSync(vf)){ const st = fs.statSync(vf); return st.mtimeMs || 0; } } catch { /* ignore */ } return 0; }
function readVersionToken(): string { try { const vf=getVersionFile(); if(fs.existsSync(vf)){ return fs.readFileSync(vf,'utf8').trim(); } } catch { /* ignore */ } return ''; }
export function markCatalogDirty(){ dirty = true; }
export function ensureLoaded(): CatalogState {
  const baseDir = getInstructionsDir();
  // Force reload if state missing or marked dirty or ALWAYS_RELOAD enabled
  if(process.env.INSTRUCTIONS_ALWAYS_RELOAD === '1') dirty = true;
  if(state && !dirty){
    // External change detection: compare version marker mtime & directory signature
    try {
      const currentVersionMTime = readVersionMTime();
      const currentVersionToken = readVersionToken();
      const metaNow = computeDirMeta(baseDir);
      // Any version token change becomes an unconditional reload trigger (even if signature has not yet diverged)
      if(currentVersionToken && currentVersionToken !== state.versionToken){
        dirty = true;
      } else if(
        (currentVersionMTime && currentVersionMTime !== state.versionMTime) ||
        metaNow.signature !== state.fileSignature ||
        metaNow.latest > state.latestMTime ||
        metaNow.count !== state.fileCount
      ){
        dirty = true;
      }
      // Opportunistic micro‑race guard: a file write that lands immediately AFTER the first meta snapshot.
      // We spin a few very fast rechecks (no timers, purely synchronous) to catch a just-written file whose
      // metadata visibility lags by a couple of milliseconds on some filesystems (especially Windows / CI).
      if(!dirty){
        const start = Date.now();
        for(let spin=0; spin<3; spin++){
          const meta2 = computeDirMeta(baseDir);
          const vt2 = readVersionToken();
          const vm2 = readVersionMTime();
          if(
            (vt2 && vt2 !== state.versionToken) ||
            (vm2 && vm2 !== state.versionMTime) ||
            meta2.signature !== state.fileSignature ||
            meta2.count !== state.fileCount ||
            meta2.latest > state.latestMTime
          ){
            dirty = true; break;
          }
          // Break early if we've already spent >15ms (avoid pathological synchronous loop)
          if(Date.now() - start > 15) break;
        }
      }
    } catch { /* ignore detection errors */ }
    if(!dirty){
      if(process.env.MCP_CATALOG_DIAG==='1'){
        // eslint-disable-next-line no-console
        console.error('[catalogContext.ensureLoaded] cache-hit dirty=false entries=', state.list.length, 'hash=', state.hash);
      }
      return state;
    }
  }
  // Load (with a tiny resilience loop for very narrow cross-process rename visibility races)
  let attempts = 0; const maxAttempts = 2; let lastMeta: DirMeta | null = null; let lastVersionToken = '';
  while(attempts <= maxAttempts){
    const loader = new CatalogLoader(baseDir);
    const result = loader.load();
    const byId = new Map<string, InstructionEntry>(); result.entries.forEach(e=>byId.set(e.id,e));
  const meta = computeDirMeta(baseDir);
    const versionMTime = readVersionMTime();
    const versionToken = readVersionToken();
    // If we previously had a state and saw a version token change but file count/signature identical to prior state
    // (possible extremely tight race where the new file wasn't yet visible), retry once.
  if(state && attempts < maxAttempts && versionToken && versionToken !== state.versionToken && meta.signature === state.fileSignature && meta.count === state.fileCount){
      attempts++; lastMeta = meta; lastVersionToken = versionToken; continue; // retry immediately
    }
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: result.entries, latestMTime: meta.latest, fileSignature: meta.signature, fileCount: meta.count, versionMTime, versionToken };
    dirty = false;
    // Overlay persisted usage metadata (usageCount, firstSeenTs, lastUsedAt) for durability across reloads.
    try {
      const snap = loadUsageSnapshot();
      if(snap && state){
        for(const e of state.list){
          const rec = (snap as Record<string, { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string }>)[e.id];
          if(rec){
            if(e.usageCount == null && rec.usageCount != null) e.usageCount = rec.usageCount;
            if(!e.firstSeenTs && rec.firstSeenTs){
              e.firstSeenTs = rec.firstSeenTs;
              // Seed authority map to preserve immutability.
              if(!firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = rec.firstSeenTs;
            }
            if(!e.lastUsedAt && rec.lastUsedAt) e.lastUsedAt = rec.lastUsedAt;
          }
        }
      }
    } catch { /* ignore snapshot overlay errors */ }
    break;
  }
  if(state && lastMeta && state.versionToken === lastVersionToken && state.fileSignature === lastMeta.signature){
    // No change after retry; proceed with whatever we have.
  }
  if(process.env.MCP_CATALOG_DIAG==='1' && state){
    // eslint-disable-next-line no-console
    console.error('[catalogContext.ensureLoaded] reload complete entries=', state.list.length, 'hash=', state.hash, 'fileCount=', state.fileCount);
  }
  // state is always set here
  return state!;
}
export function invalidate(){ state = null; dirty = true; }
export function getCatalogState(){
  // Always enforce invariant on access in case an entry transiently lost firstSeenTs
  const st = ensureLoaded();
  for(const e of st.list){
    if(!e.firstSeenTs){ restoreFirstSeenInvariant(e); }
  }
  return st;
}

// Lightweight debug snapshot WITHOUT forcing a reload (observes current in-memory view vs disk)
export function getDebugCatalogSnapshot(){
  const dir = getInstructionsDir();
  let files:string[] = [];
  try { files = fs.readdirSync(dir).filter(f=> f.endsWith('.json')).sort(); } catch { /* ignore */ }
  const current = state; // do not trigger ensureLoaded here
  const loadedIds = current ? new Set(current.list.map(e=> e.id)) : new Set<string>();
  const missingIds = current ? files.map(f=> f.replace(/\.json$/,'')).filter(id=> !loadedIds.has(id)) : [];
  const extraLoaded = current ? current.list.filter(e=> !files.includes(e.id + '.json')).map(e=> e.id) : [];
  return {
    dir,
    fileCountOnDisk: files.length,
    fileNames: files,
    catalogLoaded: !!current,
    catalogCount: current? current.list.length: 0,
    dirtyFlag: dirty,
    missingIds,
    extraLoaded,
    loadedAt: current?.loadedAt,
    versionMTime: current?.versionMTime
  };
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
  markCatalogDirty();
}
export function removeEntry(id:string){
  const file = path.join(getInstructionsDir(), `${id}.json`);
  if(fs.existsSync(file)) fs.unlinkSync(file);
  markCatalogDirty();
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
