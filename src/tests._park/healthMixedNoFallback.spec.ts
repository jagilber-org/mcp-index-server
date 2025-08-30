import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { getResponse } from './testUtils';
import { waitForDist } from './distReady';

// Variant of the mixed workload reproduction loop that ALSO asserts no synthetic
// initialize fallback markers are emitted (ensures real handshake path works).

const MARKERS = [
  'sniff_init_forced_result_emit',
  'init_unconditional_fallback_emit',
  'sniff_init_synthetic_dispatch'
];

interface RpcEnv { id?: number; result?: unknown; error?: { code: number; message: string }; __error?: string }

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio:['pipe','pipe','pipe'],
    env:{ ...process.env, MCP_LOG_VERBOSE:'0', MCP_HANDSHAKE_TRACE:'0', MCP_HEALTH_MIXED_DIAG:'1' } // gating var NOT set
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

describe('mixed workload (no synthetic initialize fallback)', () => {
  it('completes all mixed requests without emitting fallback markers', async () => {
    await waitForDist();
    const server = startServer();
    const out: string[] = []; const err: string[] = [];
    collect(server.stdout,out); collect(server.stderr,err);
    await new Promise(r=> setTimeout(r, 40));
    server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{} })+'\n');
    await get(out,1,4000);
    const ops = 10; // lighter loop here; full stress in healthMixedReproLoop
    const idToType: Record<number,string> = {};
    let nextId = 2;
    for(let i=0;i<ops;i++){
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, ...HEALTH })+'\n'); idToType[nextId++] = 'health';
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, method:'tools/call', params:{ name:'metrics/snapshot', arguments:{} } })+'\n'); idToType[nextId++] = 'metrics';
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, ...HEALTH })+'\n'); idToType[nextId++] = 'health';
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId, method:'tools/call', params:{ name:'meta/tools', arguments:{} } })+'\n'); idToType[nextId++] = 'meta';
    }
    const lastId = nextId - 1;
    const ids = Array.from({ length: lastId - 1 }, (_,i)=> i+2);
    const responses: RpcEnv[] = await Promise.all(ids.map(id=> get(out,id,8000).catch(e=>({ __error:String(e), id }) as RpcEnv)));
    const failures = responses.filter(r=> r.__error);
    if(failures.length){
      server.kill();
      throw new Error(`failures=${failures.length} ids=${failures.map(f=>f.id).join(',')}`);
    }
    server.kill();
    const stderrText = err.join('\n');
    const hits = MARKERS.filter(m=> stderrText.includes(m));
    expect(hits).toEqual([]);
  }, 40_000);
});
