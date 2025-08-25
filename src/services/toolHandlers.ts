import { registerHandler } from '../server/transport';
import { CatalogLoader } from './catalogLoader';
import { InstructionEntry } from '../models/instruction';

interface CatalogState {
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

registerHandler('instructions/list', (params: { category?: string }) => {
  const st = ensureLoaded();
  const { category } = params || {};
  let items = st.list;
  if(category){ items = items.filter(i => i.categories.includes(category.toLowerCase())); }
  return { items, hash: st.hash, count: items.length };
});

registerHandler('instructions/get', (params: { id: string }) => {
  const st = ensureLoaded();
  const item = st.byId.get(params.id);
  if(!item) return { notFound: true };
  return { item, hash: st.hash };
});

registerHandler('instructions/search', (params: { q: string }) => {
  const st = ensureLoaded();
  const q = (params.q || '').toLowerCase();
  const items = st.list.filter(i => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q));
  return { items, hash: st.hash, count: items.length };
});

registerHandler('instructions/diff', (params: { clientHash?: string }) => {
  const st = ensureLoaded();
  if(!params.clientHash || params.clientHash === st.hash){
    return { upToDate: params.clientHash === st.hash, hash: st.hash };
  }
  // Simple diff: return all items for now (optimize later)
  return { changed: st.list, hash: st.hash };
});

export {}; // ensure module scope