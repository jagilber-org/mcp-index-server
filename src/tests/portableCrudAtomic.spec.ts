/**
 * Portable CRUD Atomicity Test (Refactored)
 * Uses the portable client abstraction (createInstructionClient) instead of raw JSON-RPC framing.
 * Core invariant: Immediately after create() resolves, the new instruction MUST be present in list() and readable via read().
 * No stabilization loops or retries are employed – any absence = failure.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BODY = 'Atomic create visibility test body with deterministic content. ' + 'X'.repeat(512);

describe('Portable CRUD Atomicity (portable client)', () => {
  it('ensures create -> immediate list/get visibility; then updates and deletes (abstraction)', async () => {
    // Dynamic import (ESM client-lib inside CommonJS test env)
  // @ts-expect-error Temporary suppression: dynamic import typed via consolidated ambient declarations not directly matched by relative path.
  const { createInstructionClient } = await import('../../portable-mcp-client/client-lib.mjs');

    // Isolated temp instructions directory for determinism (unless override specified)
    const useRepoDir = process.env.PORTABLE_ATOMIC_USE_REPO_DIR === '1';
    let instructionsDir = process.env.INSTRUCTIONS_DIR;
    if(!useRepoDir){
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-atomic-'));
      instructionsDir = path.join(tmpRoot, 'instructions');
      fs.mkdirSync(instructionsDir, { recursive:true });
    }
    if(!instructionsDir) throw new Error('Failed to resolve INSTRUCTIONS_DIR');
    process.env.INSTRUCTIONS_DIR = instructionsDir;
    process.env.MCP_ENABLE_MUTATION = '1';

    const id = 'portable-atomic-' + Date.now();
    const client = await createInstructionClient({});
    try {
      // CREATE
      const created = await client.create({ id, body: BODY, categories:['atomic','test'] });
      // Optional server-side atomic verification flag (if dispatcher)
      if(created && typeof created === 'object' && 'verified' in created){
        expect((created as Record<string, unknown>).verified).toBe(true);
      }
      // LIST (immediate visibility)
  const list1 = await client.list();
  const list1Any = list1 as Record<string, unknown> | null;
  const rawItems1 = list1Any && Array.isArray(list1Any.items) ? list1Any.items : [];
  const items1: unknown[] = rawItems1;
      const ids = items1.map(i => (i && typeof i === 'object' && 'id' in i ? (i as Record<string, unknown>).id : i)).filter(Boolean);
      expect(ids).toContain(id);
      // GET (immediate read)
      const read1 = await client.read(id) as Record<string, unknown> | null;
      let body1: unknown;
      if(read1){
        const item = read1.item as Record<string, unknown> | undefined;
        body1 = item?.body ?? read1.body;
      }
      expect(body1).toBe(BODY);

      // UPDATE (overwrite semantics)
      const NEW_BODY = BODY + '\nUPDATED';
      const updated = await client.update({ id, body: NEW_BODY, categories:['atomic','test'] });
      if(updated && typeof updated === 'object' && 'verified' in updated){
        expect((updated as Record<string, unknown>).verified).toBe(true);
      }
      const read2 = await client.read(id) as Record<string, unknown> | null;
      let body2: unknown;
      if(read2){
        const item2 = read2.item as Record<string, unknown> | undefined;
        body2 = item2?.body ?? read2.body;
      }
      expect(body2).toBe(NEW_BODY);

      // DELETE
      await client.remove(id);
  const listAfter = await client.list();
  const listAfterAny = listAfter as Record<string, unknown> | null;
  const rawItemsAfter = listAfterAny && Array.isArray(listAfterAny.items) ? listAfterAny.items : [];
  const itemsAfter: unknown[] = rawItemsAfter;
  const idsAfter = itemsAfter.map(i => (i && typeof i === 'object' && 'id' in i ? (i as Record<string, unknown>).id : i)).filter(Boolean);
      expect(idsAfter).not.toContain(id);

      // Ensure subsequent read fails (either throws or returns missing)
  let postDelete: unknown;
      let threw = false;
      try { postDelete = await client.read(id); } catch { threw = true; }
      if(!threw && postDelete && typeof postDelete === 'object'){
        const pd = postDelete as Record<string, unknown>;
        const stillPresent = (pd.item && typeof pd.item === 'object') || pd.body;
        if(stillPresent) throw new Error('Deleted instruction still retrievable');
      }
    } finally {
      await client.close();
    }
  }, 15000);
});
