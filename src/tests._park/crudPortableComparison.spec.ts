/**
 * @file crudPortableComparison.spec.ts
 * Compares the golden portable MCP baseline (tool discovery & simple invocation)
 * against the MCP Index Server to surface divergence early (without yet asserting
 * on complex persistence semantics). This is Phase 1 differential coverage.
 *
 * STRATEGY:
 *  1. Ensure portable baseline already executed (crudPortableBaseline.spec.ts) to populate global.__PORTABLE_BASELINE__
 *  2. Spawn index server (existing server entrypoint) OR reuse already running test harness if present.
 *  3. Perform initialize -> tools list -> call a benign tool (echo or health) on index server.
 *  4. Compare structural invariants to baseline: tool count non-zero, required core tool parity (echo, math if implemented),
 *     response JSON parseability, absence of silent field drop.
 *  5. Log (not fail) on first detected divergence categories to allow subsequent specialized suites to run
 *     (persistence gap, batch import gap). Hard assertions only for catastrophic protocol failures.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { spawn as spawnNode } from 'child_process';

interface PortableBaselineShape {
  toolCount: number; tools: string[]; ok: boolean; [k:string]: unknown;
}

// Minimal JSON-RPC message framing for index server (stdio) interactions
interface JsonRpcRequest { jsonrpc: '2.0'; id: number; method: string; params?: Record<string, unknown>; }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number; result?: unknown; error?: unknown; }

function startIndexServer(): { proc: ReturnType<typeof spawn>; stdout: string; stderr: string; kill: () => void; onLine: (cb: (l:string)=>void) => void; } {
  const serverPath = path.resolve(process.cwd(), 'dist', 'server', 'index.js');
  const proc = spawn('node', [serverPath], { stdio: ['pipe','pipe','pipe'], env: { ...process.env, MCP_FORCE_REBUILD: '0' } });
  let stdout = ''; let stderr = ''; const listeners: ((l:string)=>void)[] = [];
  proc.stdout?.on('data', (d: Buffer) => {
    const text = d.toString();
    stdout += text;
    text.split(/\r?\n/).forEach((line: string) => { if (line.trim()) listeners.forEach(fn => fn(line)); });
  });
  proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  return { proc, stdout, stderr, kill: () => { try { proc.kill(); } catch (e) { /* ignore kill errors */ } }, onLine: cb => listeners.push(cb) };
}

async function rpcSequence(proc: ReturnType<typeof startIndexServer>['proc'], messages: JsonRpcRequest[], timeoutMs=10000): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    const responses: JsonRpcResponse[] = []; const remaining = new Set(messages.map(m=>m.id));
    const timer = setTimeout(()=> { reject(new Error('RPC timeout waiting for responses: '+[...remaining].join(','))); }, timeoutMs).unref();
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const parts = text.split(/\r?\n/).filter((l: string)=> l.startsWith('{') && l.includes('"jsonrpc"'));
      for (const p of parts) {
        try {
          const obj = JSON.parse(p) as JsonRpcResponse;
          if (obj && obj.jsonrpc === '2.0' && typeof obj.id === 'number') {
            responses.push(obj);
            remaining.delete(obj.id);
            if (remaining.size === 0) { clearTimeout(timer); resolve(responses); }
          }
        } catch { /* ignore parse errors from interleaved logs */ }
      }
    });
    for (const msg of messages) {
      const payload = JSON.stringify(msg) + '\n';
      proc.stdin?.write(payload);
    }
  });
}

// Utility to build initialize request consistent with MCP (minimal fields)
function initRequest(id=1): JsonRpcRequest { return { jsonrpc:'2.0', id, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{} } }; }

describe('CRUD Portable Comparison (Phase 1)', () => {
  it('compares baseline with index server tool discovery & echo invocation', async () => {
  const gBaseline: unknown = (globalThis as unknown as { __PORTABLE_BASELINE__?: PortableBaselineShape }).__PORTABLE_BASELINE__;
  let baseline = gBaseline as PortableBaselineShape | undefined;

    // Fallback: if baseline not established (test order variance), run portable smoke:json now.
    if (!baseline) {
      const portableDir = path.resolve(process.cwd(), 'portable');
      const child = spawnNode('npm', ['run','smoke:json'], { cwd: portableDir, shell: true, stdio:['ignore','pipe','pipe'] });
      let out='';
      await new Promise<void>((resolve,reject)=>{
        child.stdout?.on('data', d=> out += d.toString());
        child.on('error', reject);
        child.on('close', ()=> resolve());
      });
      const line = out.split(/\r?\n/).find(l=> l.trim().startsWith('{') && l.includes('toolCount'));
      if (line) {
  try { baseline = JSON.parse(line) as PortableBaselineShape; (globalThis as { __PORTABLE_BASELINE__?: PortableBaselineShape }).__PORTABLE_BASELINE__ = baseline; } catch { /* ignore parse */ }
      }
    }
    expect(baseline, 'Unable to self-seed portable baseline').toBeDefined();

    // Start index server
    const server = startIndexServer();
    try {
      // Send initialize then listTools then call echo (if available)
      const responses = await rpcSequence(server.proc, [
        initRequest(1),
        { jsonrpc:'2.0', id:2, method:'tools/list' },
      ], 12000);

      const initResp = responses.find(r=> r.id===1);
      const listResp = responses.find(r=> r.id===2);
      expect(initResp?.error, 'initialize should not error').toBeUndefined();
      expect(listResp?.error, 'tools/list should not error').toBeUndefined();
  type ListToolsResult = { tools?: { name: string }[] };
  const listResult: ListToolsResult = (listResp?.result && typeof listResp.result === 'object') ? listResp.result as ListToolsResult : {};
  const tools = Array.isArray(listResult.tools) ? listResult.tools : [];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      // Core parity checks (soft logs for differences; hard fail only if catastrophic)
      const baselineTools = new Set(baseline!.tools);
  interface ToolDesc { name: string; [k:string]: unknown }
  const indexToolNames = new Set<string>((tools as ToolDesc[]).map((t: ToolDesc)=> t.name));
      const missingFromIndex = [...baselineTools].filter(t=> !indexToolNames.has(t));
      if (missingFromIndex.length) {
        console.warn('[COMPARISON] Missing baseline tools in index server:', missingFromIndex);
      }

      // If echo present, attempt a call
      if (indexToolNames.has('echo')) {
        const callResponses = await rpcSequence(server.proc, [
          { jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'echo', arguments:{ message:'comparison ping' } } }
        ], 10000);
        const echoResp = callResponses.find(r=> r.id===3);
        if (echoResp?.error) {
          console.warn('[COMPARISON] echo call returned error:', echoResp.error);
        } else {
          expect(echoResp?.result, 'echo result structure').toBeDefined();
        }
      } else {
        console.warn('[COMPARISON] echo tool not present in index server tool list');
      }

      // Structural divergence summary (logged)
      const divergence = {
        baselineToolCount: baseline!.toolCount,
        indexToolCount: indexToolNames.size,
        missingBaselineTools: missingFromIndex,
      };
      console.log('[COMPARISON] summary', JSON.stringify(divergence));

    } finally {
      server.kill();
    }
  }, 30000);
});
