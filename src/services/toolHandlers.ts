import { registerHandler } from '../server/transport';
import crypto from 'crypto';
import { CatalogLoader } from './catalogLoader';
import { InstructionEntry } from '../models/instruction';
import { PromptReviewService, summarizeIssues } from './promptReviewService';

export interface CatalogState {
  loadedAt: string;
  hash: string;
  byId: Map<string, InstructionEntry>;
  list: InstructionEntry[];
}

let state: CatalogState | null = null;

function ensureLoaded(): CatalogState {
  if(state) return state;
  const loader = new CatalogLoader('./instructions');
  const result = loader.load();
  const byId = new Map<string, InstructionEntry>();
  result.entries.forEach(e => byId.set(e.id, e));
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: result.entries };
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

const promptService = new PromptReviewService();
registerHandler<{ prompt: string }>('prompt/review', (params) => {
  const issues = promptService.review(params.prompt || '');
  const summary = summarizeIssues(issues);
  return { issues, summary };
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

// Usage tracking (in-memory only)
registerHandler<{ id: string }>('usage/track', (params) => {
  const st = ensureLoaded();
  const id = params?.id;
  if(!id) return { error: 'missing id' };
  const entry = st.byId.get(id);
  if(!entry) return { notFound: true };
  entry.usageCount = (entry.usageCount ?? 0) + 1;
  entry.lastUsedAt = new Date().toISOString();
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

export {}; // ensure module scope