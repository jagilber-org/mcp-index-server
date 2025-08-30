import { describe, it } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { getResponse } from './testUtils';
import { waitForDist } from './distReady';

// Focused reproduction harness for the mixed workload starvation/hang observed intermittently in
// healthHangExploration.spec.ts (mixed workload scenario). Adds:
//  * Iterative loop to raise chance of reproducing quickly
//  * Verbose env flags (MCP_LOG_VERBOSE + MCP_HANDSHAKE_TRACE) for server-side diagnostics
//  * Per-id operation type mapping to see which categories starve first (health vs metrics vs meta)
//  * Tail dumps (stdout/stderr) + partial transcript dump when failure occurs
//  * Early abort on first failure with rich context

interface RpcEnv { id?: number; result?: unknown; error?: { code: number; message: string }; __error?: string }

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio:['pipe','pipe','pipe'],
  env:{ ...process.env, MCP_LOG_VERBOSE:'1', MCP_HANDSHAKE_TRACE:'1', MCP_HEALTH_MIXED_DIAG:'1' }
  });
}

function collect(stream: NodeJS.ReadableStream, sink: string[]){
  let buf='';
  stream.on('data', d=>{
    buf += d.toString();
    const parts = buf.split(/\n/); buf = parts.pop()!;
    for(const raw of parts){ const line = raw.trim(); if(line) sink.push(line); }
  });
}

async function get(lines: string[], id: number, timeoutMs: number){
  return await getResponse(lines, id, timeoutMs) as RpcEnv;
}

const HEALTH = { method: 'tools/call', params: { name: 'health/check', arguments: {} } };

const STRESS = process.env.MCP_STRESS_DIAG === '1';
describe('mixed workload reproduction loop (diagnostic)', () => {
  const maybeIt = STRESS ? it : it.skip; // skip by default to keep CI stable
  maybeIt('reproduces (if present) health starvation under mixed meta/tools + metrics + health load with diagnostics', async () => {
    await waitForDist();
    const ITERATIONS = 15; // Increase if still elusive
    for(let iter=0; iter<ITERATIONS; iter++){
      const server = startServer();
      const out: string[] = []; const err: string[] = [];
      collect(server.stdout,out); collect(server.stderr,err);
      // Slight delay to allow server to attach stdin listeners (mitigates race causing lost initialize frame)
      await new Promise(r=> setTimeout(r, 35));
      // Init
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{} })+'\n');
      try {
        await get(out,1,4000);
      } catch (e){
        // Provide enhanced diagnostics with stderr tail + any starvation lines
        const tailOut = out.slice(-80).join('\n');
        const tailErr = err.slice(-120).join('\n');
        // eslint-disable-next-line no-console
        console.error(`[mixedRepro][INIT_TIMEOUT] iter=${iter} id=1 stdout_tail_lines=${out.length} stderr_tail_lines=${err.length}`);
        // Rethrow with richer context
        throw new Error(`initialize id=1 timeout (iter=${iter})\nstdout_tail:\n${tailOut}\nstderr_tail:\n${tailErr}\noriginal=${(e as Error).message}`);
      }
      const ops = 30; // matches original scenario
      const idToType: Record<number,string> = {};
      let nextId = 2;
      for(let i=0;i<ops;i++){
        server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, ...HEALTH })+'\n'); idToType[nextId++] = 'health';
        server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, method:'tools/call', params:{ name:'metrics/snapshot', arguments:{} } })+'\n'); idToType[nextId++] = 'metrics';
        server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, ...HEALTH })+'\n'); idToType[nextId++] = 'health';
        server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, method:'tools/call', params:{ name:'meta/tools', arguments:{} } })+'\n'); idToType[nextId++] = 'meta';
      }
      const lastId = nextId - 1;
      const ids = Array.from({ length: lastId - 1 }, (_,i)=> i+2); // 2..lastId
      const deadlinePer = 12_000;
      const responses: RpcEnv[] = await Promise.all(ids.map(id=> get(out,id,deadlinePer).catch(e=>({ __error:String(e), id }) as RpcEnv)));
      const failures = responses.filter(r=> r.__error);
      if(failures.length){
        // Aggregate by type
        const byType: Record<string, number> = {};
        for(const f of failures){ const t = idToType[f.id!] || 'unknown'; byType[t] = (byType[t]||0)+1; }
        // eslint-disable-next-line no-console
        console.error(`[mixedRepro][FAIL] iter=${iter} failures=${failures.length} byType=${JSON.stringify(byType)} failingIds=${failures.map(f=>f.id).join(',')}`);
        const tailOut = out.slice(-120).join('\n');
        const tailErr = err.slice(-80).join('\n');
        server.kill();
        throw new Error(`mixed workload reproduction failure (iter=${iter})\nbyType=${JSON.stringify(byType)}\nstdout_tail:\n${tailOut}\nstderr_tail:\n${tailErr}`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`[mixedRepro][PASS] iter=${iter} all ${ids.length} responses ok`);
      }
      server.kill();
    }
  }, 180_000);
});
