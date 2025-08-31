/**
 * @fileoverview RED test reproducing persistence divergence where add/import report success
 * but list/get/hash remain unchanged (phantom write) per user-provided production report.
 *
 * STRICT RULE: This test is created BEFORE any server fixes. It must FAIL (RED) if the
 * divergence exists. After implementing the fix, this test should pass (GREEN) without
 * modification (except possibly renaming to .spec.ts removing .red marker once resolved).
 *
 * Baseline provided by user:
 * - Pre-existing catalog hash: e52a837a9ae107b0bcfc871916fa3b6b791b4287411b776f6d5cdec1dabf6e81
 * - Pre-existing instruction count: 7
 * - Five new instruction IDs whose successful add/import did NOT change list/get/hash:
 *   1. github-mermaid-dark-theme-quick-guide-2025
 *   2. github-mermaid-dark-theme-quick-guide-2025-2
 *   3. github-mermaid-dark-theme-quick-guide-2025-3
 *   4. github-mermaid-dark-theme-quick-guide-2025-4
 *   5. github-mermaid-dark-theme-quick-guide-2025-5
 *
 * Test Strategy:
 * 1. Capture initial list + hash (expect count>=7, hash recorded).
 * 2. Attempt adding the 5 instructions (overwrite:true to force materialization path) using portable client.
 * 3. For each add result assert created||overwritten true AND skipped false (if API exposes skipped).
 * 4. Immediately perform list + hash again.
 * 5. RED Assertions (expected to FAIL under current bug):
 *    - New list length should be >= initial + 5.
 *    - Each of the 5 IDs should be discoverable via list() and read().
 *    - Catalog hash should differ from baseline hash (hash change indicates state mutation).
 * 6. If any assertion fails, test remains RED until underlying persistence bug fixed.
 *
 * NOTE: We DO NOT fabricate bodies beyond a minimal deterministic constant; user required exact IDs only.
 * Body kept identical for all except ID to isolate ID-based persistence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let createInstructionClient: any; // dynamic import

const IDS = [
  'github-mermaid-dark-theme-quick-guide-2025',
  'github-mermaid-dark-theme-quick-guide-2025-2',
  'github-mermaid-dark-theme-quick-guide-2025-3',
  'github-mermaid-dark-theme-quick-guide-2025-4',
  'github-mermaid-dark-theme-quick-guide-2025-5'
];

// Minimal deterministic body & metadata (constant) focusing on persistence of ID entries.
const BASE_ENTRY = {
  title: 'GitHub Mermaid Dark Theme Quick Guide',
  body: 'Minimal body for persistence divergence reproduction. Focus on ID visibility only.',
  priority: 50,
  audience: 'all',
  requirement: 'optional',
  categories: ['github','documentation','visualization','markdown'],
  owner: 'documentation-team'
};

// Helper wrappers (any typing for portability)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function add(client: any, id: string){
  // Force overwrite to bypass skip logic and ensure write path executes fully.
  return client.create({ id, ...BASE_ENTRY }, { overwrite:true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasId(listObj: any, id: string){
  return !!listObj?.items?.some((i: any)=> i.id === id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNotFound(obj: any){ return !!obj?.notFound; }

// Attempt to acquire catalog hash if an API/tool exposes it later (placeholder)
// For now derive a synthetic hash via stable JSON stringify of IDs to catch changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveSyntheticHash(listObj: any){
  const ids = (listObj?.items||[]).map((i: any)=> i.id).sort();
  // Simple FNV-1a like hash for determinism
  let h = 2166136261 >>> 0;
  for(const id of ids){
    for(let i=0;i<id.length;i++){
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8,'0');
}

describe('RED: Instruction Persistence Divergence Reproduction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    if(!createInstructionClient){
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const mod = await import('../../portable-mcp-client/client-lib.mjs');
      createInstructionClient = mod.createInstructionClient;
    }
    const instructionsDir = process.env.TEST_INSTRUCTIONS_DIR || `${process.cwd().replace(/\\/g,'\\\\')}\\instructions`;
    client = await createInstructionClient({ forceMutation:true, instructionsDir });
  }, 60000);

  afterAll(async () => {
    await client?.close();
  });

  it('should reflect added instructions in list/get and hash (adaptive: passes when bug resolved)', async () => {
    const initialList = await client.list();
    const initialCount = (initialList.items||[]).length;
    const initialSyntheticHash = deriveSyntheticHash(initialList);
    // Track which IDs already existed (to avoid false failure when running against populated repo)
    const preExisting = new Set<string>();
    for(const id of IDS){ if(hasId(initialList, id)) preExisting.add(id); }

    // Add each instruction
    const results = [] as any[];
    for(const id of IDS){
      const r = await add(client, id);
      results.push(r);
    }

    // Basic add path assertions (should ordinarily pass even under bug)
    for(let i=0;i<results.length;i++){
      const r = results[i];
      expect(r && (r.created || r.overwritten), `Add result for ${IDS[i]}`).toBeTruthy();
      if('skipped' in r){
        expect(r.skipped, `Add should not be skipped for ${IDS[i]}`).toBe(false);
      }
    }

    // Re-list after adds
    const postList = await client.list();
    const postCount = (postList.items||[]).length;
    const postSyntheticHash = deriveSyntheticHash(postList);

    // --- Diagnostic Block (non-mutating) ---
    const diagnostics: Record<string, any> = { initialCount, postCount, initialSyntheticHash, postSyntheticHash, perId: {} };
    for(let i=0;i<IDS.length;i++){
      const id = IDS[i];
      const addResult = results[i];
      const inList = hasId(postList, id);
      let readVisible = false;
      try {
        const read = await client.read(id);
        readVisible = !isNotFound(read);
      } catch(e){
        diagnostics.perId[id] = { addResult, inList, readError: (e as Error).message };
        continue;
      }
      diagnostics.perId[id] = { addResult, inList, readVisible };
    }
    // Emit structured JSON once to aid forensic capture
    // eslint-disable-next-line no-console
    console.log('[RED-PERSISTENCE-DIAG]', JSON.stringify(diagnostics, null, 2));

    // Adaptive Assertions:
    // If some IDs were NEW (not pre-existing), ensure count increased accordingly and visibility present.
    const newlyCreated = IDS.filter(id=> !preExisting.has(id));
    if(newlyCreated.length){
      expect(postCount, 'Post-add count should increase by number of newly created IDs').toBeGreaterThanOrEqual(initialCount + newlyCreated.length);
    } else {
      // All IDs pre-existed; we expect overwrites – count may remain constant but no phantom write allowed.
      expect(postCount).toBeGreaterThanOrEqual(initialCount); // should not shrink
    }
    for(const id of IDS){
      expect(hasId(postList, id), `List should contain id ${id} after add/overwrite`).toBe(true);
      const read = await client.read(id);
      expect(isNotFound(read), `Read should succeed for ${id}`).toBe(false);
    }
    // Hash should change if any new IDs created OR any body mutations occurred; if pure overwrites with same content, allow stable hash.
    if(newlyCreated.length){
      expect(postSyntheticHash, 'Synthetic hash should change when new IDs added').not.toBe(initialSyntheticHash);
    }
  }, 60000);
});
