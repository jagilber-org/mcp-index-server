/**
 * Portable CRUD Batch Shared Server Spec
 *
 * Goal: Reduce test runtime by exercising multiple CRUD invariant scenarios
 * (atomic visibility + full update/delete sequence) against a SINGLE server
 * process instead of spawning separate servers per spec.
 *
 * Activation: Always runs, but legacy individual specs (atomic/harness) will
 * skip themselves when PORTABLE_SHARED_BATCH=1 to avoid duplication.
 *
 * Invariants Covered:
 *  1. Atomic create -> immediate list/get visibility (no retries)
 *  2. Update propagation (body mutation visible on subsequent read)
 *  3. Deletion removes instruction (subsequent get fails / missing)
 *  4. Additional second instruction processed to ensure isolation
 *
 * Implementation Notes:
 *  - Uses direct JSON-RPC framing (same approach as parameterized spec) to
 *    keep a single server process alive for all operations.
 *  - Provides rich diagnostics on failure (captures raw lines to tmp dir).
 *  - Intentionally minimal polling; atomic test fails fast to surface races.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { StdioFramingParser, buildContentLengthFrame } from './util/stdioFraming.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

function startServer(instructionsDir: string) {
  const dist = path.join(__dirname, '../../dist/server/index.js');
  if (!fs.existsSync(dist)) throw new Error('Dist server entry missing; build before running tests');
  const env = { ...process.env, MCP_ENABLE_MUTATION: '1', INSTRUCTIONS_DIR: instructionsDir } as Record<string,string>;
  return spawn(process.execPath, [dist], { stdio: ['pipe','pipe','pipe'], env });
}

function sendCL(p: ReturnType<typeof startServer>, msg: unknown){ p.stdin?.write(buildContentLengthFrame(msg)); }
async function waitForId(parser: StdioFramingParser, id: number, timeoutMs=6000){ return parser.waitForId(id, timeoutMs, 40); }

function parsePayload<T>(line: string | undefined): T {
  if(!line) throw new Error('missing line');
  const outer = JSON.parse(line);
  const txt = outer?.result?.content?.[0]?.text;
  if(typeof txt === 'string') { try { return JSON.parse(txt) as T; } catch {/* ignore */} }
  return outer as T;
}

describe('Portable CRUD Batch (shared single server)', () => {
  it('executes atomic + update/delete scenarios in one server session', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-batch-'));
    const instructionsDir = path.join(tmpRoot, 'instructions');
    fs.mkdirSync(instructionsDir, { recursive:true });

    const server = startServer(instructionsDir);
  const parser = new StdioFramingParser();
  const err: string[] = [];
  server.stdout.on('data', d=> parser.push(d.toString()));
  server.stderr.on('data', d=> err.push(...d.toString().trim().split(/\n+/)) );

    // Initialize
  sendCL(server, { jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'portable-batch', version:'0' }, capabilities:{ tools:{ listChanged:true } } } });
  const initTimeout = Math.max(8000, parseInt(process.env.TEST_HANDSHAKE_READY_TIMEOUT_MS || '12000',10));
  await waitForId(parser,1,initTimeout);

    const now = Date.now();
    const atomicId = `batch-atomic-${now}`;
    const updateId = `batch-update-${now}`;
    const bodyA = 'Atomic batch body';
    const bodyB = 'Update batch body';

    // Helper send wrapper producing incremental ids
  let rid = 10; function rpc(method: string, params: any){ const id = ++rid; sendCL(server, { jsonrpc:'2.0', id, method, params }); return id; }

    // 1. Atomic create for atomicId
  const addAtomic = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:atomicId, body: bodyA, title: atomicId, priority:50, audience:'all', requirement:'optional', categories:['batch','atomic'], lax:true }, overwrite:true, lax:true } });
  await waitForId(parser, addAtomic);
    interface AddResp { verified?: boolean; error?: string }
  const addAtomicResp = parsePayload<AddResp>(parser.findById(addAtomic)?.raw);
    expect(addAtomicResp.error).toBeUndefined();
    expect(addAtomicResp.verified).toBe(true);

    // Immediate list
  const listAtomic = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'list' } });
  await waitForId(parser, listAtomic);
    interface ListResp { items?: Array<{ id:string }>; error?: string }
  const listAtomicResp = parsePayload<ListResp>(parser.findById(listAtomic)?.raw);
    expect(listAtomicResp.error).toBeUndefined();
    expect((listAtomicResp.items||[]).map(i=>i.id)).toContain(atomicId);

    // Immediate get
  const getAtomic = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'get', id: atomicId } });
  await waitForId(parser, getAtomic);
    interface GetResp { item?: { id?: string; body?: string }; error?: string }
  const getAtomicResp = parsePayload<GetResp>(parser.findById(getAtomic)?.raw);
    expect(getAtomicResp.error).toBeUndefined();
    expect(getAtomicResp.item?.id).toBe(atomicId);
    expect(getAtomicResp.item?.body).toBe(bodyA);

    // 2. Full create + update + delete for updateId
  const addUpdate = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:updateId, body: bodyB, title:updateId, priority:50, audience:'all', requirement:'optional', categories:['batch','update'], lax:true }, overwrite:true, lax:true } });
  await waitForId(parser, addUpdate);
  const addUpdateResp = parsePayload<AddResp>(parser.findById(addUpdate)?.raw);
    expect(addUpdateResp.error).toBeUndefined();
    expect(addUpdateResp.verified).toBe(true);

    // Update (overwrite) with body append
    const newBodyB = bodyB + '\nUPDATED:' + Date.now();
  const updId = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:updateId, body:newBodyB, title:updateId, priority:50, audience:'all', requirement:'optional', categories:['batch','update'], lax:true }, overwrite:true, lax:true } });
  await waitForId(parser, updId);
  const updResp = parsePayload<AddResp>(parser.findById(updId)?.raw);
    expect(updResp.error).toBeUndefined();
    expect(updResp.verified).toBe(true);

    // Poll get until UPDATED visible (fast loop)
    let updatedVisible = false;
    for(let attempt=0; attempt<10 && !updatedVisible; attempt++){
  const gId = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'get', id:updateId } });
  await waitForId(parser, gId, 1500);
  const g = parsePayload<GetResp>(parser.findById(gId)?.raw);
      if(g.item?.body && g.item.body.includes('UPDATED:')) updatedVisible = true; else await new Promise(r=>setTimeout(r,40));
    }
    expect(updatedVisible, 'Updated body not observed').toBe(true);

    // Delete updateId
  const delId = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'remove', id:updateId } });
  await waitForId(parser, delId);

    // List should no longer contain updateId
  const listAfter = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'list' } });
  await waitForId(parser, listAfter);
  const listAfterResp = parsePayload<ListResp>(parser.findById(listAfter)?.raw);
    expect((listAfterResp.items||[]).map(i=>i.id)).not.toContain(updateId);

    // Cleanup: delete atomicId as well so tmp dir clean
  const delAtomic = rpc('tools/call', { name:'instructions/dispatch', arguments:{ action:'remove', id:atomicId } });
  await waitForId(parser, delAtomic);

    // Persist raw lines for diagnostics (always) – small size.
    try {
      const logDir = path.join(process.cwd(), 'tmp', 'portable');
      fs.mkdirSync(logDir, { recursive:true });
      const rawPath = path.join(logDir, `portable-crud-batch-raw-${Date.now()}.jsonl`);
  fs.writeFileSync(rawPath, parser.frames.map(f=>f.raw).join('\n'), 'utf8');
      // eslint-disable-next-line no-console
      console.log('[portable-crud-batch][raw-log-saved]', rawPath);
    } catch(e){ /* ignore */ }

    server.kill();
  }, 25000);
});
