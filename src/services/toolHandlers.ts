/**
 * Tool handler registration (clean implementation with mutation gating & optional verbose logging).
 * Additive changes:
 *  - Gated mutation tools via MCP_ENABLE_MUTATION=1
 *  - meta/tools now surfaces mutationEnabled + per-tool mutation|disabled flags
 *  - Lightweight stderr logging when MCP_LOG_VERBOSE=1 (all) or MCP_LOG_MUTATION=1 (mutation only)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { registerHandler, listRegisteredMethods, getMetricsRaw } from '../server/registry';
import { getToolRegistry, REGISTRY_VERSION } from './toolRegistry';
import { CatalogLoader } from './catalogLoader';
import { InstructionEntry } from '../models/instruction';
import { PromptReviewService, summarizeIssues } from './promptReviewService';

interface CatalogState { loadedAt: string; hash: string; byId: Map<string, InstructionEntry>; list: InstructionEntry[] }
let state: CatalogState | null = null;
// Local interfaces
interface UsagePersistRecord { usageCount?: number; lastUsedAt?: string }
interface ImportEntry { id:string; title:string; body:string; rationale?:string; priority:number; audience:InstructionEntry['audience']; requirement:InstructionEntry['requirement']; categories?: unknown[]; deprecatedBy?: string; riskScore?: number }
interface GateCount { id:string; type:'count'; op:string; value:number; severity:string; description?:string; where?: { requirement?: string; priorityGt?: number } }

// ---------------- Persistence (usage snapshot) ----------------
const usageSnapshotPath = path.join(process.cwd(), 'data', 'usage-snapshot.json');
let usageDirty = false; let usageWriteTimer: NodeJS.Timeout | null = null;
function ensureDataDir(){ const dir = path.dirname(usageSnapshotPath); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }
function loadUsageSnapshot(){ try { if(fs.existsSync(usageSnapshotPath)) return JSON.parse(fs.readFileSync(usageSnapshotPath,'utf8')); } catch { /* ignore */ } return {}; }
function scheduleUsageFlush(){ usageDirty = true; if(usageWriteTimer) return; usageWriteTimer = setTimeout(flushUsageSnapshot,500); }
function flushUsageSnapshot(){ if(!usageDirty) return; if(usageWriteTimer) clearTimeout(usageWriteTimer); usageWriteTimer=null; usageDirty=false; try { ensureDataDir(); if(state){ const obj: Record<string, UsagePersistRecord> = {}; for(const e of state.list){ if(e.usageCount || e.lastUsedAt){ obj[e.id] = { usageCount: e.usageCount, lastUsedAt: e.lastUsedAt }; } } fs.writeFileSync(usageSnapshotPath, JSON.stringify(obj,null,2)); } } catch {/* ignore */} }
process.on('SIGINT', ()=>{ flushUsageSnapshot(); process.exit(0); });
process.on('SIGTERM', ()=>{ flushUsageSnapshot(); process.exit(0); });
process.on('beforeExit', ()=>{ flushUsageSnapshot(); });

// ---------------- Catalog Load ----------------
function resolveInstructionsDir(): string {
  // Primary: relative to process.cwd()
  const candidates = [
    path.join(process.cwd(), 'instructions'),
    path.join(__dirname, '..', '..', 'instructions'), // when compiled output lives in dist/server/.. relative to project root
    path.join(process.cwd(), '..', 'instructions') // fallback if cwd inside a subfolder
  ];
  for(const c of candidates){
    try { if(fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  // Return first (even if missing) so loader can surface a meaningful error
  return candidates[0];
}

function ensureLoaded(): CatalogState {
  if(state) return state;
  const baseDir = resolveInstructionsDir();
  logVerbose('catalog baseDir', { baseDir });
  const loader = new CatalogLoader(baseDir);
  const result = loader.load();
  const byId = new Map<string, InstructionEntry>();
  result.entries.forEach(e => byId.set(e.id, e));
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: result.entries };
  // merge usage snapshot
  const usage = loadUsageSnapshot();
  for(const e of state.list){
    const u = (usage as Record<string, UsagePersistRecord>)[e.id];
    if(u){ e.usageCount = u.usageCount; e.lastUsedAt = u.lastUsedAt; }
  }
  logVerbose('catalog loaded', { count: state.list.length, hash: state.hash });
  return state;
}
export function getCatalogState(){ return ensureLoaded(); }

// ---------------- Logging Helpers ----------------
const VERBOSE = process.env.MCP_LOG_VERBOSE === '1';
const LOG_MUTATION_ONLY = process.env.MCP_LOG_MUTATION === '1';
function logVerbose(msg: string, obj?: unknown){ if(VERBOSE){ console.error('[tools]', msg, obj? JSON.stringify(obj):''); } }
function logMutation(event: string, detail?: unknown){ if(VERBOSE || LOG_MUTATION_ONLY){ console.error('[mutation]', event, detail? JSON.stringify(detail):''); } }

// ---------------- Mutation Gating ----------------
const MUTATION_ENABLED = process.env.MCP_ENABLE_MUTATION === '1';
interface RpcLikeError extends Error { code?: number; data?: Record<string, unknown>; }
function guardMutation<TParams, TResult>(name: string, impl:(p:TParams)=>TResult){
  return (p: TParams) => {
    if(!MUTATION_ENABLED){
      logMutation('blocked', { tool: name });
      // Throw plain object so JSON-RPC data survives SDK wrapping
      throw { code: -32603, message: 'Mutation disabled', data: { method: name, message: 'Mutation disabled' } };
    }
    const start = Date.now();
    try {
      const r = impl(p);
      logMutation('executed', { tool: name, ms: Date.now()-start });
      return r;
    } catch(e: unknown){
      logMutation('error', { tool: name, error: e instanceof Error ? e.message : String(e) });
      if(e && typeof e === 'object'){
        const err = e as RpcLikeError;
        const existingDataRaw = err.data && typeof err.data === 'object' ? err.data : {};
        const existingData: Record<string, unknown> = { ...existingDataRaw };
        const existingMsg = typeof existingData['message'] === 'string' ? String(existingData['message']) : undefined;
        const msg = err.message || existingMsg || 'mutation tool error';
        const codeCandidate = (err as { code?: unknown }).code;
        const code = typeof codeCandidate === 'number' && Number.isSafeInteger(codeCandidate) ? codeCandidate : -32603;
        throw { code, message: msg, data: { ...existingData, method: name, message: msg } };
      }
      const msg = String(e);
      throw { code: -32603, message: msg, data: { method: name, message: msg } };
    }
  };
}

// ---------------- Read-only Instruction Tools ----------------
// health/check (moved from legacy transport implementation)
let PKG_VERSION = '0.0.0';
try {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if(fs.existsSync(pkgPath)) { const raw = JSON.parse(fs.readFileSync(pkgPath,'utf8')); if(raw.version) PKG_VERSION = raw.version; }
} catch { /* ignore */ }
registerHandler('health/check', () => ({ status: 'ok', timestamp: new Date().toISOString(), version: PKG_VERSION }));
registerHandler('instructions/list', (p:{category?:string}) => {
  const st = ensureLoaded();
  let items = st.list;
  if(p?.category){ const c = p.category.toLowerCase(); items = items.filter(i => i.categories.includes(c)); }
  return { hash: st.hash, count: items.length, items };
});

// Scoped listing: choose best matching scope (user > workspace > team > all) with fallbacks
registerHandler('instructions/listScoped', (p:{ userId?:string; workspaceId?:string; teamIds?: string[] }) => {
  const st = ensureLoaded();
  const userId = p?.userId?.toLowerCase();
  const workspaceId = p?.workspaceId?.toLowerCase();
  const teamIds = (p?.teamIds || []).map(t => t.toLowerCase());
  const all = st.list;
  const matchUser = userId ? all.filter(e => (e.userId||'').toLowerCase() === userId) : [];
  if(matchUser.length) return { hash: st.hash, count: matchUser.length, scope: 'user', items: matchUser };
  const matchWorkspace = workspaceId ? all.filter(e => (e.workspaceId||'').toLowerCase() === workspaceId) : [];
  if(matchWorkspace.length) return { hash: st.hash, count: matchWorkspace.length, scope: 'workspace', items: matchWorkspace };
  const teamSet = new Set(teamIds);
  const matchTeams = teamIds.length ? all.filter(e => Array.isArray(e.teamIds) && e.teamIds.some(t => teamSet.has(t.toLowerCase()))) : [];
  if(matchTeams.length) return { hash: st.hash, count: matchTeams.length, scope: 'team', items: matchTeams };
  // Fallback to audience or all entries
  const audienceAll = all.filter(e => e.audience === 'all');
  return { hash: st.hash, count: audienceAll.length, scope: 'all', items: audienceAll };
});

registerHandler('instructions/get', (p:{id:string}) => {
  const st = ensureLoaded();
  const item = st.byId.get(p.id);
  return item ? { hash: st.hash, item } : { notFound: true };
});

registerHandler('instructions/search', (p:{q:string}) => {
  const st = ensureLoaded();
  const q = (p?.q||'').toLowerCase();
  const items = st.list.filter(i => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q));
  return { hash: st.hash, count: items.length, items };
});

registerHandler('instructions/export', (p:{ids?:string[]; metaOnly?:boolean}) => {
  const st = ensureLoaded();
  let items = st.list;
  if(p?.ids?.length){ const want = new Set(p.ids); items = items.filter(i => want.has(i.id)); }
  return { hash: st.hash, count: items.length, items };
});

// ---------------- Diff (incremental sync) ----------------
registerHandler('instructions/diff', (p:{clientHash?:string; known?:{id:string; sourceHash:string}[]}) => {
  const st = ensureLoaded();
  const clientHash = p?.clientHash;
  const known = p?.known;
  if(!known && clientHash && clientHash === st.hash) return { upToDate:true, hash: st.hash };
  if(known){
    const map = new Map<string,string>();
    for(const k of known){ if(k && k.id && !map.has(k.id)) map.set(k.id, k.sourceHash); }
    const added: InstructionEntry[] = []; const updated: InstructionEntry[] = []; const removed: string[] = [];
    for(const e of st.list){ const prev = map.get(e.id); if(prev === undefined) added.push(e); else if(prev !== e.sourceHash) updated.push(e); }
    for(const id of map.keys()){ if(!st.byId.has(id)) removed.push(id); }
    if(!added.length && !updated.length && !removed.length && clientHash === st.hash) return { upToDate:true, hash: st.hash };
    return { hash: st.hash, added, updated, removed };
  }
  if(!clientHash || clientHash !== st.hash) return { hash: st.hash, changed: st.list };
  return { upToDate:true, hash: st.hash };
});

// ---------------- Mutation Tools ----------------
registerHandler('instructions/import', guardMutation('instructions/import', (p:{entries:ImportEntry[]; mode?:'skip'|'overwrite'}) => {
  const entries = p?.entries || [];
  const mode = p?.mode || 'skip';
  if(!Array.isArray(entries) || !entries.length) return { error: 'no entries' };
  const dir = path.join(process.cwd(),'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  let imported=0, skipped=0, overwritten=0; const errors:{ id:string; error:string }[]=[];
  for(const e of entries){
  if(!e || !e.id || !e.title || !e.body){ const id = (e as Partial<ImportEntry>)?.id || 'unknown'; errors.push({ id, error:'missing required fields'}); continue; }
    const file = path.join(dir, `${e.id}.json`);
    if(fs.existsSync(file) && mode==='skip'){ skipped++; continue; }
    if(fs.existsSync(file) && mode==='overwrite') overwritten++; else if(!fs.existsSync(file)) imported++;
    const now = new Date().toISOString();
  const categories = Array.from(new Set((Array.isArray(e.categories)? e.categories: []).filter((c): c is string => typeof c === 'string').map((c:string) => c.toLowerCase()))).sort();
    const sourceHash = crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
    const record: InstructionEntry = { id:e.id, title:e.title, body:e.body, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, sourceHash, schemaVersion:'1', deprecatedBy:e.deprecatedBy, createdAt:now, updatedAt:now, riskScore:e.riskScore,
      version: '1.0.0', status: e.requirement === 'deprecated' ? 'deprecated' : 'approved', owner: 'unowned', priorityTier: e.priority <=20 || ['mandatory','critical'].includes(e.requirement)? 'P1': e.priority<=40? 'P2': e.priority<=70? 'P3':'P4', classification: 'internal', lastReviewedAt: now, nextReviewDue: now, changeLog: [{ version: '1.0.0', changedAt: now, summary: 'initial add' }]
    };
    try { fs.writeFileSync(file, JSON.stringify(record,null,2)); } catch { errors.push({ id:e.id, error:'write-failed'}); }
  }
  state = null; const st = ensureLoaded();
  return { hash: st.hash, imported, skipped, overwritten, total: entries.length, errors };
}));

registerHandler('instructions/repair', (_p?:unknown) => {
  const st = ensureLoaded();
  // Scan catalog to see if any entries would need repair.
  const toFix: { entry: InstructionEntry; actual: string }[] = [];
  for(const e of st.list){
    const actual = crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
    if(actual !== e.sourceHash) toFix.push({ entry: e, actual });
  }
  // If nothing to fix just return a no-op result (read-only, allowed when mutation disabled).
  if(!toFix.length) return { repaired: 0, updated: [] };
  // If mutation disabled, surface gated message via same error style as guardMutation for consistency.
  if(!MUTATION_ENABLED){
    throw new Error('Mutation disabled. Set MCP_ENABLE_MUTATION=1 to enable.');
  }
  const repaired: string[] = [];
  for(const { entry, actual } of toFix){
    const file = path.join(process.cwd(),'instructions', `${entry.id}.json`);
    try { const updated = { ...entry, sourceHash: actual, updatedAt: new Date().toISOString() }; fs.writeFileSync(file, JSON.stringify(updated,null,2)); repaired.push(entry.id); } catch {/* ignore */}
  }
  if(repaired.length){ state = null; ensureLoaded(); }
  return { repaired: repaired.length, updated: repaired };
});

registerHandler('usage/flush', guardMutation('usage/flush', () => { flushUsageSnapshot(); return { flushed:true }; }));

registerHandler('instructions/reload', guardMutation('instructions/reload', () => { state=null; const st=ensureLoaded(); return { reloaded:true, hash: st.hash, count: st.list.length }; }));
// Remove one or more instructions by id
registerHandler('instructions/remove', guardMutation('instructions/remove', (p:{ ids:string[]; missingOk?: boolean }) => {
  const ids = Array.isArray(p?.ids) ? Array.from(new Set(p.ids.filter(x => typeof x === 'string' && x.trim()))) : [];
  if(!ids.length) return { removed:0, missing:[], errors:['no ids supplied'] };
  const base = path.join(process.cwd(),'instructions');
  const missing: string[] = []; const removed: string[] = []; const errors: { id:string; error:string }[] = [];
  for(const id of ids){
    const file = path.join(base, `${id}.json`);
    try {
      if(!fs.existsSync(file)){ missing.push(id); continue; }
      fs.unlinkSync(file);
      removed.push(id);
    } catch(e){ errors.push({ id, error: e instanceof Error ? e.message : 'delete-failed' }); }
  }
  // Invalidate cache if anything removed
  if(removed.length){ state = null; ensureLoaded(); }
  return { removed: removed.length, removedIds: removed, missing, errorCount: errors.length, errors };
}));

// ---------------- Prompt Review ----------------
const promptService = new PromptReviewService();
registerHandler('prompt/review', (p:{prompt:string}) => {
  const raw = p?.prompt || '';
  const MAX = 10_000;
  if(raw.length > MAX) return { truncated: true, message: 'prompt too large', max: MAX };
  const sanitized = raw.replace(/\0/g,'');
  const issues = promptService.review(sanitized);
  const summary = summarizeIssues(issues);
  return { issues, summary, length: sanitized.length };
});

// ---------------- Integrity ----------------
registerHandler('integrity/verify', () => {
  const st = ensureLoaded();
  const issues: { id:string; expected:string; actual:string }[] = [];
  for(const e of st.list){
    const actual = crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
    if(actual !== e.sourceHash) issues.push({ id:e.id, expected: e.sourceHash, actual });
  }
  return { hash: st.hash, count: st.list.length, issues, issueCount: issues.length };
});

// ---------------- Usage Tracking ----------------
registerHandler('usage/track', (p:{id:string}) => {
  const st = ensureLoaded();
  const id = p?.id; if(!id) return { error:'missing id' };
  const e = st.byId.get(id); if(!e) return { notFound:true };
  e.usageCount = (e.usageCount ?? 0) + 1;
  e.lastUsedAt = new Date().toISOString();
  scheduleUsageFlush();
  return { id: e.id, usageCount: e.usageCount, lastUsedAt: e.lastUsedAt };
});

registerHandler('usage/hotset', (p:{limit?:number}) => {
  const st = ensureLoaded();
  const limit = Math.max(1, Math.min(p?.limit ?? 10, 100));
  const items = [...st.list]
    .filter(e => (e.usageCount ?? 0) > 0)
    .sort((a,b) => { const ua=a.usageCount??0, ub=b.usageCount??0; if(ub!==ua) return ub-ua; return (b.lastUsedAt||'').localeCompare(a.lastUsedAt||''); })
    .slice(0,limit)
    .map(e => ({ id:e.id, usageCount:e.usageCount, lastUsedAt:e.lastUsedAt }));
  return { hash: st.hash, count: items.length, items, limit };
});

// ---------------- Metrics ----------------
// metrics/snapshot now returns aggregated timing from registry instrumentation
registerHandler('metrics/snapshot', () => {
  const raw = getMetricsRaw();
  const methods = Object.entries(raw).map(([method, rec]) => ({
    method,
    count: rec.count,
    avgMs: rec.count ? +(rec.totalMs / rec.count).toFixed(2) : 0,
    maxMs: +rec.maxMs.toFixed(2)
  })).sort((a,b)=> a.method.localeCompare(b.method));
  return { generatedAt: new Date().toISOString(), methods };
});

// ---------------- Tool Discovery ----------------
const stableTools = new Set<string>(['health/check','instructions/list','instructions/get','instructions/search']);
const mutationTools = new Set<string>([
  'instructions/add',
  'instructions/import',
  'instructions/repair',
  'instructions/reload',
  'instructions/remove',
  'instructions/groom',
  'usage/flush'
]);
// Add (single entry) - lightweight variant of import for convenience / interactive creation
registerHandler('instructions/add', guardMutation('instructions/add', (p:{ entry: Partial<ImportEntry>; overwrite?: boolean; lax?: boolean }) => {
  const e = p?.entry || {};
  const lax = !!p?.lax;
  // Minimal required fields (unless lax, then attempt to fill defaults)
  if(!e.id || !e.body){
    if(!lax) return { error: 'missing required id/body' };
  }
  if(lax){
    // Apply defaults if absent
    if(!e.title) e.title = e.id || 'untitled';
    if(typeof e.priority !== 'number') e.priority = 50;
    if(!e.audience) e.audience = 'all' as InstructionEntry['audience'];
    if(!e.requirement) e.requirement = 'optional' as InstructionEntry['requirement'];
    if(!Array.isArray(e.categories)) e.categories = [];
  }
  if(!e.id || !e.title || !e.body || typeof e.priority !== 'number' || !e.audience || !e.requirement){
    return { error: 'missing required fields', id: e.id };
  }
  const dir = path.join(process.cwd(),'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir, `${e.id}.json`);
  const exists = fs.existsSync(file);
  const overwrite = !!p?.overwrite;
  if(exists && !overwrite){
    // Return catalog hash for caller to decide follow-up (like reload)
    const st0 = ensureLoaded();
    return { id: e.id, skipped: true, created: false, overwritten: false, hash: st0.hash };
  }
  const now = new Date().toISOString();
  const categories = Array.from(new Set((Array.isArray(e.categories)? e.categories: []).filter((c): c is string => typeof c === 'string').map((c:string) => c.toLowerCase()))).sort();
  const sourceHash = crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
  const record: InstructionEntry = { id:e.id, title:e.title, body:e.body, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, sourceHash, schemaVersion:'1', deprecatedBy:e.deprecatedBy, createdAt: now, updatedAt: now, riskScore: e.riskScore,
    version: '1.0.0', status: e.requirement === 'deprecated' ? 'deprecated' : 'approved', owner: 'unowned', priorityTier: e.priority <=20 || ['mandatory','critical'].includes(e.requirement)? 'P1': e.priority<=40? 'P2': e.priority<=70? 'P3':'P4', classification: 'internal', lastReviewedAt: now, nextReviewDue: now, changeLog: [{ version: '1.0.0', changedAt: now, summary: 'initial add' }]
  };
  try { fs.writeFileSync(file, JSON.stringify(record,null,2)); } catch(err){ return { id: e.id, error: (err as Error).message || 'write-failed' }; }
  // Invalidate & reload
  state = null; const st = ensureLoaded();
  return { id: e.id, created: !exists, overwritten: exists && overwrite, skipped:false, hash: st.hash };
}));

// Catalog grooming (normalization, duplicate merge, deprecated cleanup)
registerHandler('instructions/groom', guardMutation('instructions/groom', (p:{ mode?: { dryRun?: boolean; removeDeprecated?: boolean; mergeDuplicates?: boolean; purgeLegacyScopes?: boolean } }) => {
  const mode = p?.mode || {};
  const dryRun = !!mode.dryRun;
  const removeDeprecated = !!mode.removeDeprecated;
  const mergeDuplicates = !!mode.mergeDuplicates;
  const purgeLegacyScopes = !!mode.purgeLegacyScopes;
  const stBefore = ensureLoaded();
  const previousHash = stBefore.hash;
  const scanned = stBefore.list.length;
  let repairedHashes = 0;
  let normalizedCategories = 0;
  let deprecatedRemoved = 0;
  let duplicatesMerged = 0;
  let usagePruned = 0;
  let filesRewritten = 0;
  let purgedScopes = 0; // number of legacy scope:* category tokens removed
  const notes: string[] = [];
  // Work on mutable clones of entries
  const byId = new Map<string, InstructionEntry>();
  stBefore.list.forEach(e => byId.set(e.id, { ...e }));
  // Track updated entries
  const updated = new Set<string>();
  // 1. Normalize categories (hash repair deferred until after merges to avoid double hashing)
  for(const e of byId.values()){
    const normCats = Array.from(new Set((e.categories||[]).filter(c => typeof c === 'string').map(c => c.toLowerCase()))).sort();
    if(JSON.stringify(normCats) !== JSON.stringify(e.categories)){ e.categories = normCats; normalizedCategories++; e.updatedAt = new Date().toISOString(); updated.add(e.id); }
  }
  // 2. Duplicate detection & merge
  const duplicateBodies = new Set<string>();
  if(mergeDuplicates){
    const groups = new Map<string, InstructionEntry[]>();
    for(const e of byId.values()){
      const key = e.sourceHash || crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
      const arr = groups.get(key) || []; arr.push(e); groups.set(key, arr);
    }
    for(const group of groups.values()){
      if(group.length <= 1) continue;
      // Pick primary: earliest createdAt else lexicographically smallest id
      let primary = group[0];
      for(const candidate of group){
        if(candidate.createdAt && primary.createdAt){
          if(candidate.createdAt < primary.createdAt) primary = candidate;
        } else if(!primary.createdAt && candidate.createdAt){
          primary = candidate;
        } else if(candidate.id < primary.id){
          primary = candidate;
        }
      }
  for(const dup of group){
        if(dup.id === primary.id) continue;
        // Merge metadata
        // Priority: keep lower numeric (higher importance)
        if(dup.priority < primary.priority) { primary.priority = dup.priority; updated.add(primary.id); }
        // RiskScore: keep max
        if(typeof dup.riskScore === 'number'){ if(typeof primary.riskScore !== 'number' || dup.riskScore > primary.riskScore){ primary.riskScore = dup.riskScore; updated.add(primary.id); } }
        // Categories union
        const mergedCats = Array.from(new Set([...(primary.categories||[]), ...(dup.categories||[])] )).sort();
        if(JSON.stringify(mergedCats) !== JSON.stringify(primary.categories)){ primary.categories = mergedCats; updated.add(primary.id); }
        // Mark duplicate deprecated or schedule for removal
        if(removeDeprecated){
          duplicateBodies.add(dup.id); // mark for removal in removal phase
        } else {
          if(dup.deprecatedBy !== primary.id){ dup.deprecatedBy = primary.id; dup.requirement = 'deprecated'; dup.updatedAt = new Date().toISOString(); updated.add(dup.id); }
        }
        duplicatesMerged++;
      }
    }
  }
  // 3. Deprecated removal pass
  const toRemove: string[] = [];
  if(removeDeprecated){
    for(const e of byId.values()){
      if(e.deprecatedBy && byId.has(e.deprecatedBy)) toRemove.push(e.id);
    }
    // Also remove explicitly marked duplicate bodies
    for(const id of duplicateBodies){ if(!toRemove.includes(id)) toRemove.push(id); }
  }
  // 4a. Optional purge of legacy scope:* category tokens from on-disk JSON (classification already stripped them in-memory)
  if(purgeLegacyScopes){
    const baseDir = resolveInstructionsDir();
    for(const e of byId.values()){
      const filePath = path.join(baseDir, `${e.id}.json`);
      try {
        if(fs.existsSync(filePath)){
          const raw = JSON.parse(fs.readFileSync(filePath,'utf8')) as { categories?: unknown[] };
          if(Array.isArray(raw.categories)){
            const legacyTokens = raw.categories.filter(c => typeof c === 'string' && /^scope:(workspace|user|team):/.test(c));
            if(legacyTokens.length){
              purgedScopes += legacyTokens.length;
              updated.add(e.id); // ensure rewrite without those tokens
            }
          }
        }
      } catch { /* ignore */ }
    }
    if(dryRun && purgedScopes) notes.push(`would-purge:${purgedScopes}`);
  }
  // 4b. Final hash repair (post merge) comparing on-disk stored hash, since loader normalization may already have set e.sourceHash
  {
    const baseDir = resolveInstructionsDir();
    for(const e of byId.values()){
      const filePath = path.join(baseDir, `${e.id}.json`);
      let storedHash = e.sourceHash || '';
      try {
        if(fs.existsSync(filePath)){
          const raw = JSON.parse(fs.readFileSync(filePath,'utf8')) as { sourceHash?: string };
          if(typeof raw.sourceHash === 'string') storedHash = raw.sourceHash;
        }
      } catch { /* ignore read errors; fallback to in-memory */ }
      const actualHash = crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
      if(storedHash !== actualHash){
        e.sourceHash = actualHash;
        repairedHashes++;
        e.updatedAt = new Date().toISOString();
        updated.add(e.id);
      }
    }
  }
  deprecatedRemoved = toRemove.length;
  // 4. Apply changes (write / delete files) unless dryRun
  if(!dryRun){
    const baseDir = resolveInstructionsDir();
    for(const id of toRemove){ byId.delete(id); }
    for(const id of updated){ if(!byId.has(id)) continue; const e = byId.get(id)!; try { fs.writeFileSync(path.join(baseDir, `${id}.json`), JSON.stringify(e,null,2)); filesRewritten++; } catch(err){ notes.push(`write-failed:${id}:${(err as Error).message}`); } }
    for(const id of toRemove){ try { fs.unlinkSync(path.join(baseDir, `${id}.json`)); } catch(err){ notes.push(`delete-failed:${id}:${(err as Error).message}`); } }
    if(updated.size || toRemove.length){ state = null; ensureLoaded(); }
    // Prune usage snapshot if entries removed
    if(toRemove.length){
      try {
        if(fs.existsSync(usageSnapshotPath)){
          const usage = JSON.parse(fs.readFileSync(usageSnapshotPath,'utf8')) as Record<string, unknown>;
          let mutated = false;
            for(const id of toRemove){ if(id in usage){ delete usage[id]; mutated = true; usagePruned++; } }
          if(mutated){ fs.writeFileSync(usageSnapshotPath, JSON.stringify(usage,null,2)); }
        }
      } catch { /* ignore */ }
    }
  } else {
    // Dry run notes
    if(updated.size) notes.push(`would-rewrite:${updated.size}`);
    if(toRemove.length) notes.push(`would-remove:${toRemove.length}`);
  }
  const stAfter = state ? state : ensureLoaded();
  return { previousHash, hash: stAfter.hash, scanned, repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, usagePruned, filesRewritten, purgedScopes, dryRun, notes };
}));
/**
 * meta/tools now returns a split object separating deterministic (stable) data
 * from dynamic environment/time dependent data. This helps contract tests stay
 * resilient by focusing on stable.tools while still exposing runtime state.
 */
registerHandler('meta/tools', () => {
  const methods = listRegisteredMethods();
  const all = methods.map(m => ({
    method: m,
    stable: stableTools.has(m),
    mutation: mutationTools.has(m),
    disabled: mutationTools.has(m) && !MUTATION_ENABLED
  }));
  const registry = getToolRegistry();
  return {
    // Back-compat: original flat list so existing agents can still read tools
    tools: all.map(({ method, stable, mutation, disabled }) => ({ method, stable, mutation, disabled })),
    stable: { tools: all.map(({ method, stable, mutation }) => ({ method, stable, mutation })) },
    dynamic: {
      generatedAt: new Date().toISOString(),
      mutationEnabled: MUTATION_ENABLED,
      disabled: all.filter(t => t.disabled).map(t => ({ method: t.method }))
    },
    // MCP style registry (experimental)
    mcp: {
      registryVersion: REGISTRY_VERSION,
      tools: registry.map(r => ({
        name: r.name,
        description: r.description,
        stable: r.stable,
        mutation: r.mutation,
        inputSchema: r.inputSchema,
        outputSchema: r.outputSchema
      }))
    }
  };
});

// ---------------- Gates ----------------
registerHandler('gates/evaluate', () => {
  const st = ensureLoaded();
  const gatesPath = path.join(process.cwd(),'instructions','gates.json');
  if(!fs.existsSync(gatesPath)) return { notConfigured:true };
  let data: { gates:GateCount[] };
  try { data = JSON.parse(fs.readFileSync(gatesPath,'utf8')); } catch { return { error:'invalid gates file' }; }
  const results: { id:string; passed:boolean; count:number; op:string; value:number; severity:string; description?:string }[] = [];
  for(const g of data.gates || []){
    if(g.type !== 'count') continue;
    const matches = st.list.filter(e => {
      const w = g.where || {};
      let ok = true;
      if(w.requirement !== undefined) ok = ok && e.requirement === w.requirement;
      if(w.priorityGt !== undefined) ok = ok && e.priority > w.priorityGt;
      return ok;
    });
    const count = matches.length; const v = g.value; let passed = true;
    switch(g.op){
      case '>=': passed = count >= v; break;
      case '>': passed = count > v; break;
      case '<=': passed = count <= v; break;
      case '<': passed = count < v; break;
      case '==': passed = count === v; break;
      case '!=': passed = count !== v; break;
    }
    results.push({ id:g.id, passed, count, op:g.op, value:v, severity:g.severity, description:g.description });
  }
  const summary = { errors: results.filter(r => !r.passed && r.severity==='error').length, warnings: results.filter(r => !r.passed && r.severity==='warn').length, total: results.length };
  return { generatedAt: new Date().toISOString(), results, summary };
});

// ---------------- Standard MCP Protocol Handlers ----------------
// These are the core MCP methods that clients like VS Code expect
// tools/list & tools/call now provided by SDK server; removed here.

export {}; // module scope