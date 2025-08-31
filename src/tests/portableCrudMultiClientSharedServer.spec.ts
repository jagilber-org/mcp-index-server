/**
 * Portable CRUD Multi-Client Shared Server Test
 *
 * Spins up a SINGLE index server process and attaches TWO independent portable clients
 * performing interleaved CRUD operations against the same shared instructions directory.
 *
 * Invariants:
 *  - Client A create is immediately list/get visible to Client B.
 *  - Client B update is immediately visible to Client A.
 *  - Deletion by either client removes visibility for both clients.
 *
 * Logging:
 *  - Structured log lines prefixed with [portable-crud-shared].
 *  - Each client tagged (A or B) in output for trace clarity.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// NOTE: The original intent was to attach multiple portable clients to a single long‑lived
// stdio MCP process. The current server implementation exposes ONLY a single stdio transport
// (one logical client per process). True multi‑attach over stdio would require a multiplexing
// layer that does not yet exist. The previous implementation attempted to spawn a headless
// server with stdin ignored and wait for a synthetic '[ready]' sentinel; this proved flaky
// (server_exited_0 / server_start_timeout) and provided no additional coverage beyond the
// existing multi‑client reproduction suites (which already validate shared directory
// consistency across separate server processes).
//
// This spec is therefore repurposed to explicitly validate cross‑process consistency by
// spawning TWO independent portable client/server pairs pointing at the SAME instructions
// directory. This preserves the core invariant goals (immediate visibility, update
// propagation, deletion consistency) without relying on an unsupported shared stdio model.
//
// If/when a multiplexed transport is introduced, this test can be extended rather than
// removed. Keeping the filename avoids churn in documentation and historical references.

function makeTempDir(prefix:string){ return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

describe('Portable CRUD Multi-Client Shared Server (simulated via shared directory)', () => {
  it('supports immediate cross-client visibility and update propagation', async () => {
    // Dynamic ESM import (runtime to avoid TS ESM warnings)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { createInstructionClient } = await import('../../portable-mcp-client/client-lib.mjs');

    const root = makeTempDir('portable-shared-');
    const instructionsDir = path.join(root, 'instructions');
    fs.mkdirSync(instructionsDir, { recursive:true });
    process.env.INSTRUCTIONS_DIR = instructionsDir; // ensure child servers target same dir

    // Spawn two independent clients (each spawns its own server process) sharing the dir
    const clientA = await createInstructionClient({ verbose:true, instructionsDir });
    const clientB = await createInstructionClient({ verbose:true, instructionsDir });

    const id = 'shared-' + Date.now();
    const BODY1 = 'Shared body 1';
    const created = await clientA.create({ id, body: BODY1, categories:['shared','a'] });
    expect(created).toBeTruthy();
    console.log('[portable-crud-shared] client=A action=create id=%s', id);

    // Client B visibility
    const readFromB = await clientB.read(id);
    const bodyB = (readFromB && typeof readFromB === 'object' && ((readFromB as any).item?.body || (readFromB as any).body)) || undefined;
    expect(bodyB).toBe(BODY1);
    console.log('[portable-crud-shared] client=B observe=create id=%s', id);

    // Client B update
    const BODY2 = BODY1 + ' updated';
    await clientB.update({ id, body: BODY2, categories:['shared','b'] });
    console.log('[portable-crud-shared] client=B action=update id=%s', id);

    // Client A sees update
    const readFromA2 = await clientA.read(id);
    const bodyA2 = (readFromA2 && typeof readFromA2 === 'object' && ((readFromA2 as any).item?.body || (readFromA2 as any).body)) || undefined;
    expect(bodyA2).toBe(BODY2);
    console.log('[portable-crud-shared] client=A observe=update id=%s', id);

    // Client A deletes
    await clientA.remove(id);
    console.log('[portable-crud-shared] client=A action=delete id=%s', id);

    // Client B confirms deletion
    let deletedVisible = false;
    try {
      const post = await clientB.read(id);
      if(post && typeof post === 'object' && ((post as any).item?.body || (post as any).body)) deletedVisible = true;
    } catch { /* expected */ }
    if(deletedVisible) throw new Error('Deleted instruction still retrievable (cross-client)');
    console.log('[portable-crud-shared] client=B observe=delete id=%s', id);

    await clientA.close();
    await clientB.close();
    console.log('[portable-crud-shared] phase=done ok id=%s', id);
  }, 20000);
});
