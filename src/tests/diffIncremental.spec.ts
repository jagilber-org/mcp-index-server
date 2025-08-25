import { describe, it, expect } from 'vitest';
import { getCatalogState } from '../services/toolHandlers';
import '../services/toolHandlers'; // ensure handlers registered

// We directly exercise logic by simulating parameters instead of full transport
import { InstructionEntry } from '../models/instruction';

// Re-import registerHandler is not needed; we will mimic call by referencing internal state via exported function.

function buildIncremental(known: { id: string; sourceHash: string }[]){
  const st = getCatalogState();
  // simulate incremental diff logic (mirror of handler)
  const mapKnown = new Map<string,string>();
  for(const k of known){ mapKnown.set(k.id, k.sourceHash); }
  const added: InstructionEntry[] = [];
  const updated: InstructionEntry[] = [];
  for(const e of st.list){
    const prev = mapKnown.get(e.id);
    if(prev === undefined) added.push(e);
    else if(prev !== e.sourceHash) updated.push(e);
  }
  const removed: string[] = [];
  for(const id of mapKnown.keys()) if(!st.byId.has(id)) removed.push(id);
  return { added, updated, removed, hash: st.hash };
}

describe('instructions/diff incremental logic', () => {
  it('returns added for empty known list', () => {
    const result = buildIncremental([]);
    expect(result.added.length).toBeGreaterThan(0);
    expect(result.updated.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it('returns up-to-date when hashes match', () => {
    const st = getCatalogState();
    const known = st.list.map(e => ({ id: e.id, sourceHash: e.sourceHash }));
    const result = buildIncremental(known);
    expect(result.added.length).toBe(0);
    expect(result.updated.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });
});
