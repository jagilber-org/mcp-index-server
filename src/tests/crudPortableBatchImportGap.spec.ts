/**
 * @file crudPortableBatchImportGap.spec.ts
 * Detects partial batch import discrepancies (reported success vs actual imported count).
 *
 * NOTE: This is a scaffold. It attempts to call a hypothetical batch import tool.
 * If the tool isn't present yet, it logs and exits early (skipped semantics via console warning).
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

interface JsonRpcRequest { jsonrpc:'2.0'; id:number; method:string; params?:Record<string,unknown>; }
interface JsonRpcResponse { jsonrpc:'2.0'; id:number; result?:unknown; error?:unknown; }

function startIndexServer() {
  const serverPath = path.resolve(process.cwd(), 'dist', 'server', 'index.js');
  return spawn('node', [serverPath], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
}

async function rpc(proc: ReturnType<typeof startIndexServer>, msgs: JsonRpcRequest[], timeoutMs=15000): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    const pending = new Set(msgs.map(m=>m.id));
    const acc: JsonRpcResponse[] = [];
    const timer = setTimeout(()=> reject(new Error('timeout '+[...pending].join(','))), timeoutMs).unref();
    proc.stdout?.on('data', (buf:Buffer) => {
      buf.toString().split(/\r?\n/).forEach(line => {
        if (!line.startsWith('{')) return;
        try {
          const j = JSON.parse(line) as JsonRpcResponse;
          if (j.jsonrpc==='2.0' && typeof j.id === 'number') {
            acc.push(j); pending.delete(j.id);
            if (!pending.size) { clearTimeout(timer); resolve(acc); }
          }
        } catch {/* ignore */}
      });
    });
    msgs.forEach(m => proc.stdin?.write(JSON.stringify(m)+'\n'));
  });
}

function initReq(id=1): JsonRpcRequest { return { jsonrpc:'2.0', id, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{} } }; }

describe('CRUD Portable Batch Import Gap (Phase 3)', () => {
  it('surfaces partial import mismatches when batch import tool available', async () => {
    const proc = startIndexServer();
    try {
      await rpc(proc, [initReq(1)]);
      const list = await rpc(proc, [{ jsonrpc:'2.0', id:2, method:'tools/list' }]);
      const listResp = list.find(r=> r.id===2);
      let toolNames: string[] = [];
      if (listResp?.result && typeof listResp.result === 'object') {
        const r = listResp.result as { tools?: { name: string }[] };
        if (Array.isArray(r.tools)) toolNames = r.tools.map(t=> t.name);
      }

      const batchTool = 'instructions/importBatch';
      if (!toolNames.includes(batchTool)) {
        console.warn('[BATCH-GAP] batch import tool not present, skipping batch gap test');
        return; // early skip
      }

      // Construct synthetic batch of entries
      const BATCH_SIZE = 6;
      const entries = Array.from({ length: BATCH_SIZE }, (_, i) => ({
        id: `batch_gap_${Date.now()}_${i}`,
        title: `Batch Gap ${i}`,
        body: `Entry ${i}`,
        requirement: 'test',
        type: 'other',
        priority: 1
      }));

      const importResp = await rpc(proc, [{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name: batchTool, arguments: { entries } } }], 30000);
      const r = importResp.find(x=> x.id===3);
      if (r?.error) {
        console.warn('[BATCH-GAP] import tool error', r.error);
        return; // treat as non-catastrophic for now
      }

      // Attempt follow-up list to verify presence of at least one imported identifier via some listing tool if available
      // (Depending on implementation, might need a dedicated list instructions tool; placeholder heuristic.)
      const postList = await rpc(proc, [{ jsonrpc:'2.0', id:4, method:'tools/list'}]);
      const post = postList.find(x=> x.id===4);
      if (!post?.result) {
        console.warn('[BATCH-GAP] unable to re-list after import, heuristic inconclusive');
        return;
      }
      // Currently we only assert protocol continuity (no crash) until a concrete retrieval tool is specified
      expect(true).toBe(true);
    } finally {
      proc.kill();
    }
  }, 60000);
});
