/**
 * Portable CRUD Harness Spec
 * Purpose: Validate end-to-end create -> read -> update -> read -> delete using the
 * shared portable client library (client-lib.mjs). This is the first refactored
 * spec moving away from raw JSON-RPC framing toward the reusable abstraction.
 *
 * Behavior:
 *  - Uses a temp INSTRUCTIONS_DIR (unless PORTABLE_HARNESS_USE_REPO_DIR=1)
 *  - Generates deterministic id unless PORTABLE_HARNESS_ID provided
 *  - Asserts atomic visibility (read after create) and body mutation after update
 *  - Ensures deletion succeeds (follow-up read is expected to fail or return missing)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Portable CRUD Harness (client-lib)', () => {
	it('runs a full CRUD sequence via runCrudSequence()', async () => {
		// Use typed shim (portableClientShim) to avoid pulling external d.ts into tsconfig scope.
		// Import via TS shim with explicit .js extension (Node16 module resolution requires extension)
		const { runCrudSequence, createInstructionClient } = await import('../portableClientShim.js');

		// Ephemeral instructions directory unless explicitly reusing repo dir.
		const useRepoDir = process.env.PORTABLE_HARNESS_USE_REPO_DIR === '1';
		let instructionsDir = process.env.INSTRUCTIONS_DIR;
		if (!useRepoDir) {
			const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-harness-'));
			instructionsDir = path.join(tmpRoot, 'instructions');
			fs.mkdirSync(instructionsDir, { recursive: true });
		}
		if (!instructionsDir) throw new Error('Failed to resolve INSTRUCTIONS_DIR');
		// Propagate so spawned server child picks it up.
		process.env.INSTRUCTIONS_DIR = instructionsDir;
		process.env.MCP_ENABLE_MUTATION = '1';

		const id = process.env.PORTABLE_HARNESS_ID || `portable-harness-${Date.now()}`;
		const initialBody = 'Harness initial body';
		const updatedBody = initialBody + ' :: UPDATED';

		// Run orchestrated CRUD sequence (spawns its own connection/server transport).
		const seq = await runCrudSequence({ id, body: initialBody, updateBody: updatedBody, categories:['harness','test'] });

		expect(seq.failures, 'Sequence reported failures').toEqual([]);
		const createdAny = seq.created as Record<string, unknown> | undefined;
		function pick(obj: Record<string, unknown> | undefined, path: string[]): unknown {
			let cur: unknown = obj;
			for (const segment of path) {
				if (cur && typeof cur === 'object' && segment in (cur as Record<string, unknown>)) {
					cur = (cur as Record<string, unknown>)[segment];
				} else return undefined;
			}
			return cur;
		}
		const createdId = pick(createdAny, ['id']) || pick(createdAny, ['item','id']);
		expect(createdId).toBe(id);
		// First read body matches initial
		const read1Any = seq.read1 as Record<string, unknown> | undefined;
		const read1Body = pick(read1Any, ['item','body']) || pick(read1Any, ['body']);
		expect(read1Body).toContain(initialBody);
		// Updated body present
		const read2Any = seq.read2 as Record<string, unknown> | undefined;
		const read2Body = pick(read2Any, ['item','body']) || pick(read2Any, ['body']);
		expect(read2Body).toContain('UPDATED');

		// Additional explicit deletion validation using discrete client ops (reuse abstraction)
		// Establish a new client to confirm the item is gone (runCrudSequence already removed it)
		const client = await createInstructionClient({});
		let postDeleteRead: unknown;
		try { postDeleteRead = await client.read(id); } catch (e) { /* acceptable: not found */ }
		await client.close();
		const deletedProbe = postDeleteRead as Record<string, unknown> | undefined;
		if ((deletedProbe && 'item' in deletedProbe) || (deletedProbe && 'body' in deletedProbe)) {
			throw new Error('Deleted instruction still retrievable in follow-up client session');
		}

		// Emit concise JSON summary for external harnesses.
		// eslint-disable-next-line no-console
		console.log('[portable-crud-harness][summary]', JSON.stringify({ id, ok: seq.ok, failures: seq.failures, dir: instructionsDir }));
	}, 20000);
});

