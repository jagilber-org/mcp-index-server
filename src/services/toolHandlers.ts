import { registerHandler, getMetrics, listRegisteredMethods } from '../server/transport';
import crypto from 'crypto';
import { CatalogLoader } from './catalogLoader';
import { InstructionEntry } from '../models/instruction';
import { PromptReviewService, summarizeIssues } from './promptReviewService';
import fs from 'fs';
import path from 'path';

export interface CatalogState {
  loadedAt: string;
  hash: string;
  byId: Map<string, InstructionEntry>;
  list: InstructionEntry[];
}

let state: CatalogState | null = null;
const usageSnapshotPath = path.join(process.cwd(), 'data', 'usage-snapshot.json');
let usageDirty = false;
let usageWriteTimer: NodeJS.Timeout | null = null;

function ensureDataDir(){
  const dir = path.dirname(usageSnapshotPath);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadUsageSnapshot(): Record<string, { usageCount?: number; lastUsedAt?: string }>{
  try {
    if(fs.existsSync(usageSnapshotPath)){
      return JSON.parse(fs.readFileSync(usageSnapshotPath,'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function scheduleUsageFlush(){
  usageDirty = true;
  if(usageWriteTimer) return;
  usageWriteTimer = setTimeout(flushUsageSnapshot, 500);
}

function flushUsageSnapshot(){
  if(!usageDirty) return;
  usageWriteTimer && clearTimeout(usageWriteTimer);
  usageWriteTimer = null;
  usageDirty = false;
  try {
    ensureDataDir();
    if(state){
      const obj: Record<string, { usageCount?: number; lastUsedAt?: string }> = {};
      for(const e of state.list){
        if(e.usageCount || e.lastUsedAt){
          obj[e.id] = { usageCount: e.usageCount, lastUsedAt: e.lastUsedAt };
        }
      }
      fs.writeFileSync(usageSnapshotPath, JSON.stringify(obj, null, 2));
    }
  } catch { /* swallow */ }
}

process.on('SIGINT', () => { flushUsageSnapshot(); process.exit(0); });
process.on('SIGTERM', () => { flushUsageSnapshot(); process.exit(0); });
process.on('beforeExit', () => { flushUsageSnapshot(); });

function ensureLoaded(): CatalogState {
  if(state) return state;
  const loader = new CatalogLoader('./instructions');
  const result = loader.load();
  const byId = new Map<string, InstructionEntry>();
  result.entries.forEach(e => byId.set(e.id, e));
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: result.entries };
  // merge usage snapshot
  const usage = loadUsageSnapshot();
  for(const e of state.list){
    const u = usage[e.id];
    if(u){ e.usageCount = u.usageCount; e.lastUsedAt = u.lastUsedAt; }
  }
  return state;
}

export function getCatalogState(): CatalogState { return ensureLoaded(); }

registerHandler<{ category?: string }>('instructions/list', (params) => {
  const st = ensureLoaded();
  const { category } = params || {};
  let items = st.list;
  if(category){ items = items.filter(i => i.categories.includes(category.toLowerCase())); }
  return { items, hash: st.hash, count: items.length };
});

registerHandler<{ id: string }>('instructions/get', (params) => {
  const st = ensureLoaded();
  const item = st.byId.get(params.id);
  if(!item) return { notFound: true };
  return { item, hash: st.hash };
});

registerHandler<{ q: string }>('instructions/search', (params) => {
  const st = ensureLoaded();
  const q = (params.q || '').toLowerCase();
  const items = st.list.filter(i => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q));
  return { items, hash: st.hash, count: items.length };
});

// Export instructions (optionally subset by ids)
registerHandler<{ ids?: string[]; metaOnly?: boolean }>('instructions/export', (params) => {
  const st = ensureLoaded();
  let items = st.list;
  if(params?.ids && params.ids.length){
    const want = new Set(params.ids);
    items = items.filter(i => want.has(i.id));
  }
  // metaOnly currently returns full items; future: strip body
  return { hash: st.hash, count: items.length, items };
});

interface KnownEntry { id: string; sourceHash: string }
interface DiffParams { clientHash?: string; known?: KnownEntry[] }
registerHandler<DiffParams>('instructions/diff', (params) => {
  const st = ensureLoaded();
  const clientHash = params?.clientHash;
  const known = params?.known;
  // Fast path when hashes match and no known inventory provided
  if(!known && clientHash && clientHash === st.hash){
    return { upToDate: true, hash: st.hash };
  }
  if(known){
    const mapKnown = new Map<string, string>();
    for(const k of known){ if(k && k.id) { if(!mapKnown.has(k.id)) mapKnown.set(k.id, k.sourceHash); } }
    const added: InstructionEntry[] = [];
    const updated: InstructionEntry[] = [];
    for(const entry of st.list){
      const prev = mapKnown.get(entry.id);
      if(prev === undefined){ added.push(entry); }
      else if(prev !== entry.sourceHash){ updated.push(entry); }
    }
    const removed: string[] = [];
    for(const id of mapKnown.keys()){
      if(!st.byId.has(id)) removed.push(id);
    }
    if(added.length === 0 && updated.length === 0 && removed.length === 0 && clientHash === st.hash){
      return { upToDate: true, hash: st.hash };
    }
    return { hash: st.hash, added, updated, removed };
  }
  // Legacy fallback behaviour when only clientHash supplied: return full set when mismatch
  if(!clientHash || clientHash !== st.hash){
    return { hash: st.hash, changed: st.list };
  }
  return { upToDate: true, hash: st.hash }; // should have been caught earlier
});

// Import instructions (create/update on disk) - experimental mutation tool
interface ImportEntry { id: string; title: string; body: string; priority: number; audience: InstructionEntry['audience']; requirement: InstructionEntry['requirement']; categories: string[]; rationale?: string; deprecatedBy?: string; riskScore?: number }
interface ImportParams { entries: ImportEntry[]; mode?: 'skip'|'overwrite' }
registerHandler<ImportParams>('instructions/import', (params) => {
  const entries = params?.entries || [];
  const mode = params?.mode || 'skip';
  if(!Array.isArray(entries) || entries.length === 0){ return { error: 'no entries' }; }
  const dir = path.join(process.cwd(), 'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let imported = 0; let skipped = 0; let overwritten = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for(const e of entries){
    if(!e || !e.id || !e.title || !e.body){ errors.push({ id: e?.id || 'unknown', error: 'missing required fields'}); continue; }
    const id = e.id;
    const file = path.join(dir, `${id}.json`);
    if(fs.existsSync(file) && mode === 'skip'){ skipped++; continue; }
    if(fs.existsSync(file) && mode === 'overwrite'){ overwritten++; }
    else if(!fs.existsSync(file)) { imported++; }
    const now = new Date().toISOString();
    const categories = Array.from(new Set((e.categories||[]).map(c => c.toLowerCase()))).sort();
    const sourceHash = crypto.createHash('sha256').update(e.body,'utf8').digest('hex');
    const record: InstructionEntry = {
      id,
      title: e.title,
      body: e.body,
      rationale: e.rationale,
      priority: e.priority,
      audience: e.audience,
      requirement: e.requirement,
      categories,
      sourceHash,
      schemaVersion: '1',
      deprecatedBy: e.deprecatedBy,
      createdAt: now,
      updatedAt: now,
      riskScore: e.riskScore
    };
    try {
      fs.writeFileSync(file, JSON.stringify(record, null, 2));
    } catch(err){
      errors.push({ id, error: 'write-failed' });
    }
  }
  // reload state to incorporate new/updated entries
  state = null;
  const st = ensureLoaded();
  return { hash: st.hash, imported, skipped, overwritten, errors, total: entries.length };
});

const promptService = new PromptReviewService();
registerHandler<{ prompt: string }>('prompt/review', (params) => {
  const raw = params?.prompt || '';
  const MAX = 10_000; // 10KB limit
  if(raw.length > MAX){
    return { truncated: true, message: 'prompt too large', max: MAX };
  }
  // basic sanitization: remove null bytes
  const sanitized = raw.replace(/\0/g,'');
  const issues = promptService.review(sanitized);
  const summary = summarizeIssues(issues);
  return { issues, summary, length: sanitized.length };
});

// Integrity verification tool: recompute body hash and compare with stored sourceHash
registerHandler('integrity/verify', () => {
  const st = ensureLoaded();
  const issues: Array<{ id: string; expected: string; actual: string }> = [];
  for(const entry of st.list){
    // recompute sha256 of body
    const actual = crypto.createHash('sha256').update(entry.body,'utf8').digest('hex');
    if(actual !== entry.sourceHash){
      issues.push({ id: entry.id, expected: entry.sourceHash, actual });
    }
  }
  return { hash: st.hash, count: st.list.length, issues, issueCount: issues.length };
});

// Repair tool: recompute and fix mismatched sourceHash values on disk
registerHandler('instructions/repair', () => {
  const st = ensureLoaded();
  const repaired: string[] = [];
  for(const entry of st.list){
    const actual = crypto.createHash('sha256').update(entry.body,'utf8').digest('hex');
    if(actual !== entry.sourceHash){
      // rewrite file with corrected sourceHash
      const file = path.join(process.cwd(), 'instructions', `${entry.id}.json`);
      try {
        const updated = { ...entry, sourceHash: actual, updatedAt: new Date().toISOString() };
        fs.writeFileSync(file, JSON.stringify(updated, null, 2));
        repaired.push(entry.id);
      } catch { /* ignore write error */ }
    }
  }
  if(repaired.length){ state = null; ensureLoaded(); }
  return { repaired: repaired.length, updated: repaired };
});

// Usage tracking (in-memory only)
registerHandler<{ id: string }>('usage/track', (params) => {
  const st = ensureLoaded();
  const id = params?.id;
  if(!id) return { error: 'missing id' };
  const entry = st.byId.get(id);
  if(!entry) return { notFound: true };
  entry.usageCount = (entry.usageCount ?? 0) + 1;
  entry.lastUsedAt = new Date().toISOString();
  scheduleUsageFlush();
  return { id: entry.id, usageCount: entry.usageCount, lastUsedAt: entry.lastUsedAt };
});

registerHandler<{ limit?: number }>('usage/hotset', (params) => {
  const st = ensureLoaded();
  const limit = Math.max(1, Math.min( params?.limit ?? 10, 100));
  const items = [...st.list]
    .filter(e => (e.usageCount ?? 0) > 0)
    .sort((a,b) => {
      const ua = a.usageCount ?? 0; const ub = b.usageCount ?? 0;
      if(ub !== ua) return ub - ua;
      const ta = a.lastUsedAt || ''; const tb = b.lastUsedAt || '';
      return tb.localeCompare(ta); // most recent first
    })
    .slice(0, limit)
    .map(e => ({ id: e.id, usageCount: e.usageCount, lastUsedAt: e.lastUsedAt }));
  return { hash: st.hash, count: items.length, items, limit };
});

// Metrics snapshot
registerHandler('metrics/snapshot', () => {
  const raw = getMetrics();
  const methods = Object.entries(raw).map(([method, rec]) => ({
    method,
    count: rec.count,
    avgMs: rec.count ? +(rec.totalMs / rec.count).toFixed(2) : 0,
    maxMs: rec.maxMs
  }));
  return { generatedAt: new Date().toISOString(), methods };
});

// Tool discovery
const stableTools = new Set<string>(['health/check','instructions/list','instructions/get','instructions/search']);
registerHandler('meta/tools', () => {
  const methods = listRegisteredMethods();
  return {
    generatedAt: new Date().toISOString(),
    tools: methods.map(m => ({ method: m, stable: stableTools.has(m) }))
  };
});

// Force usage flush
registerHandler('usage/flush', () => { flushUsageSnapshot(); return { flushed: true }; });

// Reload (reindex) instructions from disk
registerHandler('instructions/reload', () => {
  state = null; // drop cache
  const st = ensureLoaded();
  return { reloaded: true, hash: st.hash, count: st.list.length };
});

// Gates evaluation
interface GateWhere { requirement?: string; priorityGt?: number }
interface GateRule { id: string; description?: string; type: 'count'; where: GateWhere; op: '>='|'>'|'<='|'<'|'=='|'!='; value: number; severity: 'error'|'warn'; }
registerHandler('gates/evaluate', () => {
  const st = ensureLoaded();
  const p = path.join(process.cwd(), 'instructions', 'gates.json');
  if(!fs.existsSync(p)) return { notConfigured: true };
  let data: { gates: GateRule[] };
  try { data = JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ return { error: 'invalid gates file' }; }
  const results: Array<{ id: string; passed: boolean; count: number; op: string; value: number; severity: string; description?: string }> = [];
  for(const g of data.gates || []){
    if(g.type !== 'count'){ continue; }
    const matches = st.list.filter(e => {
      const w = g.where || {};
      let ok = true;
      if(w.requirement !== undefined) ok = ok && e.requirement === w.requirement;
      if(w.priorityGt !== undefined) ok = ok && e.priority > w.priorityGt;
      return ok;
    });
    const count = matches.length;
    const v = g.value;
    let passed = true;
    switch(g.op){
      case '>=': passed = count >= v; break;
      case '>': passed = count > v; break;
      case '<=': passed = count <= v; break;
      case '<': passed = count < v; break;
      case '==': passed = count === v; break;
      case '!=': passed = count !== v; break;
    }
    results.push({ id: g.id, passed, count, op: g.op, value: v, severity: g.severity, description: g.description });
  }
  const summary = {
    errors: results.filter(r => !r.passed && r.severity === 'error').length,
    warnings: results.filter(r => !r.passed && r.severity === 'warn').length,
    total: results.length
  };
  return { generatedAt: new Date().toISOString(), results, summary };
});

export {}; // ensure module scope