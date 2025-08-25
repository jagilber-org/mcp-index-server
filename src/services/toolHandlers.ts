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

registerHandler<{ clientHash?: string }>('instructions/diff', (params) => {
  const st = ensureLoaded();
  if(!params.clientHash || params.clientHash === st.hash){
    return { upToDate: params.clientHash === st.hash, hash: st.hash };
  }
  // Simple diff: return all items for now (optimize later)
  return { changed: st.list, hash: st.hash };
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

export {}; // ensure module scope