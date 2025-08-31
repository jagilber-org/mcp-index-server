/**
 * Portable CRUD Persistence Across Restart Test
 *
 * Validates that instructions created via the portable client persist after a full server shutdown
 * and restart (new process) when sharing the same INSTRUCTIONS_DIR.
 *
 * Invariants:
 *  - After first client creates an instruction it is immediately list/get visible.
 *  - After closing the client (terminating server) and starting a NEW client pointing to the
 *    SAME instructions directory, the instruction remains list/get visible.
 *  - Deletion in the second session removes the instruction permanently (subsequent read fails).
 *
 * Logging:
 *  - Emits structured phase logs with a [portable-crud-persist-restart] prefix.
 *  - Echoes the portable client summary outputs where applicable.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

function delay(ms:number){ return new Promise(r=>setTimeout(r, ms)); }

// Minimal helper to extract body from read() response supporting both dispatcher + legacy shapes
function extractBody(obj:unknown): string | undefined {
  if(!obj || typeof obj !== 'object') return undefined;
  const any = obj as Record<string, unknown>;
  const item = any.item && typeof any.item === 'object' ? any.item as Record<string, unknown> : undefined;
  return (item?.body as string) || (any.body as string) || undefined;
}

describe('Portable CRUD Persistence (restart)', () => {
  it('retains created instruction across full server restart', async () => {
    // Dynamic ESM import of portable client helpers
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { createInstructionClient } = await import('../../portable-mcp-client/client-lib.mjs');

    // Shared persistent instructions directory
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-persist-'));
    const instructionsDir = path.join(tmpRoot, 'instructions');
    fs.mkdirSync(instructionsDir, { recursive: true });

    process.env.INSTRUCTIONS_DIR = instructionsDir;
    process.env.MCP_ENABLE_MUTATION = '1';

    const id = 'persist-restart-' + Date.now();
    const BODY = 'Persistence body test ' + new Date().toISOString();

    console.log('[portable-crud-persist-restart] phase=init dir=%s id=%s', instructionsDir, id);

    // Session 1: create + validate immediate visibility
    const client1 = await createInstructionClient({});
    try {
      const created = await client1.create({ id, body: BODY, categories:['persist','restart','test'] });
      expect(created).toBeTruthy();

      const list1 = await client1.list();
      const items = (list1 && typeof list1 === 'object' && Array.isArray((list1 as any).items)) ? (list1 as any).items : [];
      const ids1 = items.map((i: any) => i && i.id).filter(Boolean);
      expect(ids1).toContain(id);

      const read1 = await client1.read(id);
      expect(extractBody(read1)).toBe(BODY);
      console.log('[portable-crud-persist-restart] phase=session1 validated id=%s', id);
    } finally {
      await client1.close();
    }

    // Simulate clean shutdown gap
    await delay(250);

    // Session 2: start new client (new server process) pointing at SAME directory
    const client2 = await createInstructionClient({});
    try {
      const list2 = await client2.list();
      const items2 = (list2 && typeof list2 === 'object' && Array.isArray((list2 as any).items)) ? (list2 as any).items : [];
      const ids2 = items2.map((i: any) => i && i.id).filter(Boolean);
      expect(ids2).toContain(id);

      const read2 = await client2.read(id);
      expect(extractBody(read2)).toBe(BODY);
      console.log('[portable-crud-persist-restart] phase=session2 verified-persistence id=%s', id);

      // Delete and confirm removal
      await client2.remove(id);
      const listAfter = await client2.list();
      const itemsAfter = (listAfter && typeof listAfter === 'object' && Array.isArray((listAfter as any).items)) ? (listAfter as any).items : [];
      const idsAfter = itemsAfter.map((i: any) => i && i.id).filter(Boolean);
      expect(idsAfter).not.toContain(id);

      let deletedVisible = false;
      try {
        const post = await client2.read(id);
        if(extractBody(post)) deletedVisible = true; // still retrievable
      } catch { /* expected throw acceptable */ }
      if(deletedVisible) throw new Error('Deleted instruction still retrievable');
      console.log('[portable-crud-persist-restart] phase=session2 deletion-confirmed id=%s', id);
    } finally {
      await client2.close();
    }

    console.log('[portable-crud-persist-restart] phase=done ok id=%s', id);
  }, 20000);
});
