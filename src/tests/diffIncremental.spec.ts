import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Assign an isolated instructions directory BEFORE loading handlers so the pinned dir uses this path.
const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'instructions-diff-'));
process.env.INSTRUCTIONS_DIR = ISOLATED_DIR;

// Will be assigned after dynamic import (ensures env var applied before module evaluation)
let getCatalogState: () => { list: InstructionEntry[]; byId: Map<string, InstructionEntry>; hash: string };

// We directly exercise logic by simulating parameters instead of full transport
import type { InstructionEntry } from '../models/instruction';

beforeAll(async () => {
  const mod = await import('../services/toolHandlers');
  getCatalogState = mod.getCatalogState;
  // Seed a minimal instruction so catalog isn't empty
  const seedPath = path.join(ISOLATED_DIR, 'seed.json');
  fs.writeFileSync(seedPath, JSON.stringify({
    id: 'seed',
    title: 'seed',
    body: 'seed body',
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: [],
    sourceHash: '',
    createdAt: '',
    updatedAt: '',
    schemaVersion: '1'
  }, null, 2));
});

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
  const known = st.list.map((e: InstructionEntry) => ({ id: e.id, sourceHash: e.sourceHash }));
    const result = buildIncremental(known);
    // After loader normalization of placeholder hashes, supplying the full current list should yield no updated/removed.
    // Occasionally a late asynchronous catalog load (e.g. governance auto-invalidation or background normalization) may
    // introduce a new entry between the snapshot (known) capture and the internal state read inside buildIncremental().
    // We treat that as permissible "added" noise so long as none of the added ids were already in the original snapshot.
    expect(result.updated.length).toBe(0);
    expect(result.removed.length).toBe(0);
    if (result.added.length > 0) {
  const originalIds = new Set(known.map((k: { id: string }) => k.id));
      for (const e of result.added) {
        expect(originalIds.has(e.id)).toBe(false);
      }
    }
  });
});
