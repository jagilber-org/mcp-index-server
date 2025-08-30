/**
 * Portable CRUD Parameterized Test (Red/Green Guard)
 *
 * Purpose:
 *  - Provides a single, fast CRUD verification loop over one or more user-supplied instruction specs.
 *  - Fails (RED) if any add operation doesn't return verified:true or if immediate list/get visibility fails.
 *  - Passes (GREEN) when atomic create + read invariants hold for all provided instructions.
 *
 * How to supply instructions (choose one):
 *  1. Environment variable PORTABLE_CRUD_INSTRUCTIONS_JSON containing a JSON array of entries:
 *     Example:
 *       PORTABLE_CRUD_INSTRUCTIONS_JSON='[{"title":"Demo A","body":"Line 1"},{"id":"fixed-id","title":"Specific","body":"Body","priority":10}]'
 *  2. Environment variable PORTABLE_CRUD_FILE pointing at a JSON file with an array of entry objects.
 *  3. Environment variable PORTABLE_CRUD_BODY for a single quick body (auto‑wraps into one entry).
 *
 * Entry Normalization:
 *  - id (optional): auto-generated if missing -> portable-param-<index>-<timestamp>
 *  - title defaults to id (or 'Untitled <index>')
 *  - body REQUIRED (will fail fast if absent)
 *  - priority defaults to 50
 *  - audience defaults to 'all'
 *  - requirement defaults to 'optional'
 *  - categories defaults to [] (can be provided as categories array or comma separated string via categoriesCsv)
 *  - owner optional (only enforced if you explicitly set priorityTier P1 / requirement critical|mandatory)
 *
 * Isolation:
 *  - By default uses a temp INSTRUCTIONS_DIR to avoid polluting repo catalogs.
 *  - Set PORTABLE_CRUD_USE_REPO_DIR=1 to reuse current process INSTRUCTIONS_DIR (if you want to exercise prod/dev dirs).
 *
 * Exit Diagnostics:
 *  - Logs concise JSON summary to stdout for external harness consumption.
 *
 * Red/Green Strategy:
 *  - Any failure in atomic visibility invariants turns test red.
 *  - Stable success = green guard preventing regression of atomic_readback failures.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

interface UserInstructionInput { id?: string; title?: string; body: string; priority?: number; audience?: 'all'|'group'|'individual'; requirement?: string; categories?: string[]; categoriesCsv?: string; owner?: string; }

function loadUserInstructions(): UserInstructionInput[] {
  const envJson = process.env.PORTABLE_CRUD_INSTRUCTIONS_JSON;
  const filePath = process.env.PORTABLE_CRUD_FILE;
  const singleBody = process.env.PORTABLE_CRUD_BODY;
  let entries: UserInstructionInput[] = [];
  try {
    if (envJson) {
      const parsed = JSON.parse(envJson);
      if (Array.isArray(parsed)) entries = parsed as UserInstructionInput[];
      else throw new Error('PORTABLE_CRUD_INSTRUCTIONS_JSON must be a JSON array');
    } else if (filePath) {
      const txt = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) entries = parsed as UserInstructionInput[];
      else throw new Error('PORTABLE_CRUD_FILE content must be a JSON array');
    } else if (singleBody) {
      entries = [{ body: singleBody }];
    }
  } catch (e) {
    throw new Error(`Failed to parse supplied instructions: ${(e as Error).message}`);
  }
  if (!entries.length) {
    // Provide a deterministic default single entry (green path)
    entries = [{ body: 'Default portable CRUD body for parameterized test.' }];
  }
  return entries;
}

function materialize(entries: UserInstructionInput[]) {
  const ts = Date.now();
  return entries.map((e, idx) => {
    const id = e.id || `portable-param-${idx}-${ts}`;
    const title = e.title || e.id || `Untitled ${idx}`;
    const priority = typeof e.priority === 'number' ? e.priority : 50;
    const audience = (e.audience || 'all') as 'all'|'group'|'individual';
    const requirement = (e.requirement || 'optional') as 'optional';
    let categories = Array.isArray(e.categories) ? e.categories.slice() : [];
    if (e.categoriesCsv) categories.push(...e.categoriesCsv.split(',').map(c => c.trim()).filter(Boolean));
    categories = Array.from(new Set(categories.map(c => c.toLowerCase())));
    if (!e.body || !e.body.trim()) throw new Error(`Entry index ${idx} missing body`);
    return { id, title, body: e.body, priority, audience, requirement, categories, owner: e.owner };
  });
}

function startServer(customInstructionsDir?: string) {
  const dist = path.join(__dirname, '../../dist/server/index.js');
  if (!fs.existsSync(dist)) throw new Error('Dist server entry missing; build before running tests');
  const env = { ...process.env, MCP_ENABLE_MUTATION: '1' } as Record<string, string>;
  if (customInstructionsDir) env.INSTRUCTIONS_DIR = customInstructionsDir;
  return spawn(process.execPath, [dist], { stdio: ['pipe', 'pipe', 'pipe'], env });
}

function send(p: ReturnType<typeof startServer>, msg: unknown) { p.stdin?.write(JSON.stringify(msg) + '\n'); }
function findLine(lines: string[], id: number) { return lines.find(l => { try { return JSON.parse(l).id === id; } catch { return false; } }); }
async function waitFor(fn: () => boolean, timeoutMs = 6000, interval = 40) { const s = Date.now(); while (Date.now() - s < timeoutMs) { if (fn()) return; await new Promise(r => setTimeout(r, interval)); } throw new Error('timeout'); }
function parsePayload<T>(line: string | undefined): T { if (!line) throw new Error('missing line'); const o = JSON.parse(line); const txt = o?.result?.content?.[0]?.text; if (txt) { try { return JSON.parse(txt); } catch { /* ignore */ } } return o as T; }

describe('Portable CRUD Parameterized', () => {
  it('executes atomic create/list/get/update/delete for supplied instructions', async () => {
    const raw = loadUserInstructions();
    const entries = materialize(raw);
    const useRepoDir = process.env.PORTABLE_CRUD_USE_REPO_DIR === '1';
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-crud-param-'));
  const instructionsDir = useRepoDir ? (process.env.INSTRUCTIONS_DIR || path.join(tempRoot,'instructions-repo-fallback')) : path.join(tempRoot, 'instructions');
  if (!useRepoDir) fs.mkdirSync(instructionsDir, { recursive: true });

    const server = startServer(instructionsDir);
    const out: string[] = []; const err: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));
    server.stderr.on('data', d => err.push(...d.toString().trim().split(/\n+/)));

    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'portable-crud-param', version: '0' }, capabilities: { tools: {} } } });
    await waitFor(() => !!findLine(out, 1));

    const summary: { id: string; created: boolean; updated: boolean; deleted: boolean; roundTripHash?: string }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      // CREATE
      send(server, { jsonrpc: '2.0', id: 100 + i * 10 + 1, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'add', entry: { ...e }, overwrite: true, lax: true } } });
      await waitFor(() => !!findLine(out, 100 + i * 10 + 1));
      const addPayload = parsePayload<{ id: string; verified?: boolean; error?: string }>(findLine(out, 100 + i * 10 + 1));
      expect(addPayload.error).toBeUndefined();
      expect(addPayload.verified).toBe(true);

      // LIST immediate
      send(server, { jsonrpc: '2.0', id: 100 + i * 10 + 2, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'list' } } });
      await waitFor(() => !!findLine(out, 100 + i * 10 + 2));
      const listPayload = parsePayload<{ items: Array<{ id: string }> }>(findLine(out, 100 + i * 10 + 2));
      expect(listPayload.items.map(x => x.id)).toContain(e.id);

      // GET immediate
      send(server, { jsonrpc: '2.0', id: 100 + i * 10 + 3, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'get', id: e.id } } });
      await waitFor(() => !!findLine(out, 100 + i * 10 + 3));
      const getPayload = parsePayload<{ item?: { id: string; body: string; sourceHash?: string } }>(findLine(out, 100 + i * 10 + 3));
      expect(getPayload.item?.id).toBe(e.id);
      expect(getPayload.item?.body).toContain(e.body.slice(0, 16));

      // UPDATE (idempotent overwrite with small body append) + poll until visible
      const updatedBody = e.body + '\nUPDATE:' + Date.now();
      send(server, { jsonrpc: '2.0', id: 100 + i * 10 + 4, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'add', entry: { ...e, body: updatedBody }, overwrite: true, lax: true } } });
      await waitFor(() => !!findLine(out, 100 + i * 10 + 4));
      const updPayload = parsePayload<{ id: string; verified?: boolean; error?: string; body?: string; item?: { body?: string } }>(findLine(out, 100 + i * 10 + 4));
      expect(updPayload.error).toBeUndefined();
      expect(updPayload.verified).toBe(true);

      // Poll for eventual consistency of updated body. Some code paths emit body in different shapes.
      let updatedProbe: string | undefined;
      const maxPolls = 14;
      for (let attempt = 0; attempt < maxPolls && !updatedProbe; attempt++) {
        const pollId = 100 + i * 10 + 50 + attempt; // avoid collision with other fixed ids
        send(server, { jsonrpc: '2.0', id: pollId, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'get', id: e.id } } });
        await waitFor(() => !!findLine(out, pollId), 1500, 35);
        const polled = parsePayload<{ item?: { body?: string }; body?: string }>(findLine(out, pollId));
        const candidates: Array<unknown> = [
          updPayload.item?.body,
          updPayload.body,
          polled.item?.body,
          polled.body
        ];
        updatedProbe = candidates.find(v => typeof v === 'string' && (v as string).includes('UPDATE:')) as string | undefined;
        if (!updatedProbe) await new Promise(r => setTimeout(r, 50));
      }
      if (!updatedProbe) {
        // Provide rich diagnostics before failing to aid debugging of rare timing issues
        // eslint-disable-next-line no-console
        console.error('[portable-crud-param][update-miss]', { id: e.id, lastUpd: updPayload });
      }
      expect(updatedProbe && updatedProbe.includes('UPDATE:'), 'Expected at least one body variant containing UPDATE:').toBe(true);

      // DELETE
      send(server, { jsonrpc: '2.0', id: 100 + i * 10 + 6, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'remove', id: e.id } } });
      await waitFor(() => !!findLine(out, 100 + i * 10 + 6));

      // LIST after delete -> should not contain
      send(server, { jsonrpc: '2.0', id: 100 + i * 10 + 7, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'list' } } });
      await waitFor(() => !!findLine(out, 100 + i * 10 + 7));
      const listAfterDelete = parsePayload<{ items: Array<{ id: string }> }>(findLine(out, 100 + i * 10 + 7));
      expect(listAfterDelete.items.map(x => x.id)).not.toContain(e.id);

      summary.push({ id: e.id, created: true, updated: !!updatedProbe, deleted: true });
    }

    // eslint-disable-next-line no-console
    console.log('[portable-crud-param][summary]', JSON.stringify({ count: entries.length, summary }));
    server.kill();
  }, 30000);
});
