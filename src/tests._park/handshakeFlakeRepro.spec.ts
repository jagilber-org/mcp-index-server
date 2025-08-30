import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

// Purpose: aggressively attempt to reproduce reported real-client handshake / health hang
// by simulating multiple logical clients racing initialize, tools/list, tools/call (health + diagnostics),
// issuing pre-initialize tool calls, fragmented frame writes, and event-loop blocking sequences.
// This goes beyond existing tests by:
//  * Randomizing ordering (sometimes tools/list & health before initialize response, sometimes even before initialize send)
//  * Injecting diagnostics/block & microtaskFlood during the narrow window where ready emission is scheduled (setImmediate + transport send hook)
//  * Fragmenting JSON lines into small chunks with short random delays to mimic real client stream flushing
//  * Repeating many iterations in a single process to chase rare races (watchdog vs transport send vs listChanged buffering)
//  * Occasionally disabling the stdin sniff fallback (MCP_DISABLE_INIT_SNIFF) to exercise differing internal code paths.
// If a hang / missing ready occurs the test will fail fast with detailed diagnostic dump.

interface JsonRpc { jsonrpc:'2.0'; id?: number|string|null; method:string; params?: Record<string, unknown>; }

// Minimal JSON-RPC response shape used locally for parsing lines
interface JsonRpcResponse { jsonrpc:'2.0'; id?: number|string|null; result?: unknown; error?: unknown; method?: string; params?: unknown; }

function startServer(extraEnv: Record<string,string|undefined> = {}){
  return spawn('node',[path.join(process.cwd(),'dist','server','index.js')],{
    stdio:['pipe','pipe','pipe'],
    env:{ ...process.env, MCP_HEALTH_MIXED_DIAG:'1', MCP_LOG_VERBOSE:'1', MCP_HANDSHAKE_TRACE:'1', ...extraEnv }
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

function fragWrite(proc: ReturnType<typeof startServer>, obj: JsonRpc){
  const line = JSON.stringify(obj)+'\n';
  // Write in 1-4 char fragments with tiny jitter to simulate partial flushes
  let i=0; let delay=0;
  while(i < line.length){
    const slice = line.slice(i, i + Math.max(1, Math.min(4, Math.floor(Math.random()*4)+1)));
    setTimeout(()=>{ try { proc.stdin.write(slice); } catch { /* ignore */ } }, delay);
    i += slice.length;
    delay += Math.floor(Math.random()*3); // 0-2ms spacing
  }
}

async function waitForLine(lines: string[], predicate: (l:string)=>boolean, timeoutMs: number){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    if(lines.some(predicate)) return true;
    await new Promise(r=> setTimeout(r,5));
  }
  return false;
}

function extractStatus(result: unknown): string | undefined {
  if(!result) return undefined;
  if(typeof result === 'object' && result !== null){
    const rAny = result as Record<string, unknown>;
    if(typeof rAny.status === 'string') return rAny.status;
    const content = rAny.content;
    if(Array.isArray(content)){
      const first = content[0] as unknown;
      if(first && typeof first === 'object'){
        const text = (first as Record<string, unknown>).text;
        if(typeof text === 'string'){
          try { const parsed: unknown = JSON.parse(text); return extractStatus(parsed); } catch { /* ignore parse errors */ }
          if(text.trim() === 'ok') return 'ok';
        }
      }
    }
  }
  return undefined;
}

const STRESS = process.env.MCP_STRESS_DIAG === '1';

describe('handshake / health hang reproduction (aggressive multi-pattern fuzz)', () => {
  // NOTE: This is an intentionally pathological fuzz harness that interleaves fragment writes from *different* JSON-RPC messages.
  // That can produce byte-interleaving not representative of real clients (which flush whole frames sequentially). It is
  // now gated behind MCP_STRESS_DIAG to avoid blocking normal CI / prod readiness. Enable by setting MCP_STRESS_DIAG=1.
  const maybeIt = STRESS ? it : it.skip; // skip by default in prod
  // Single vitest "test" performing many iterations to surface flake without spawning dozens of spec entries.
  maybeIt('racy multi-client style handshake sequences do not lose ready or hang health/check', async () => {
    // Escalate iteration count if needed; start with 120 to keep total runtime reasonable; can increase if still not reproduced.
  const ITERATIONS = STRESS ? 120 : 5; // keep a small sample when enabled
    // If we discover a failure condition, throw with captured diagnostics.
    for(let iter=0; iter<ITERATIONS; iter++){
      const disableSniff = (iter % 5) === 0; // 20% of runs disable init sniff fallback
      const server = startServer(disableSniff ? { MCP_DISABLE_INIT_SNIFF:'1' } : {});
      const out: string[] = []; const err: string[] = [];
      collect(server.stdout,out); collect(server.stderr,err);

      let nextId = 1;
      const initId = nextId++;
      const listId = nextId++;
      const healthEarlyId = nextId++;
      const blockId = nextId++;
      const microId = nextId++;
      const healthPostId = nextId++;

      const sendInitFirst = Math.random() < 0.7; // 70% send initialize first, 30% delay to after other frames

      if(sendInitFirst){
        fragWrite(server,{ jsonrpc:'2.0', id:initId, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'fuzz', version:'0.0.0' }, capabilities:{ tools:{} } } });
      }
      // Race: sometimes fire tools/list before initialize
      if(Math.random() < 0.5){ fragWrite(server,{ jsonrpc:'2.0', id:listId, method:'tools/list', params:{} }); }
      // Race: early health (tools/call) before initialize / before ready
      if(Math.random() < 0.6){ fragWrite(server,{ jsonrpc:'2.0', id:healthEarlyId, method:'tools/call', params:{ name:'health/check', arguments:{} } }); }
      // Inject blocking + microtask flood as soon as possible (after a tiny timeout so initialize scheduling occurs)
      setTimeout(()=>{
        fragWrite(server,{ jsonrpc:'2.0', id:blockId, method:'tools/call', params:{ name:'diagnostics/block', arguments:{ ms: 120 + Math.floor(Math.random()*80) } } });
        fragWrite(server,{ jsonrpc:'2.0', id:microId, method:'tools/call', params:{ name:'diagnostics/microtaskFlood', arguments:{ count: 5000 + Math.floor(Math.random()*5000) } } });
      }, 0);
      // Optionally send initialize AFTER others (late init path)
      if(!sendInitFirst){
        setTimeout(()=> fragWrite(server,{ jsonrpc:'2.0', id:initId, method:'initialize', params:{ protocolVersion:'2025-06-18' } }), Math.floor(Math.random()*10));
      }
      // Schedule guaranteed health after chaos to verify recovery
      setTimeout(()=> fragWrite(server,{ jsonrpc:'2.0', id:healthPostId, method:'tools/call', params:{ name:'health/check', arguments:{} } }), 20);

      // Wait for initialize response (id:initId) or fail if not present in 2s
      const initOk = await waitFor(()=> out.some(l=> l.includes(`"id":${initId}`) && l.includes('protocolVersion')), 2000);
      if(!initOk){
        server.kill();
        throw new Error(`[repro][iter=${iter}] initialize response missing after 2s\nSTDOUT:\n${out.slice(0,200).join('\n')}\nSTDERR:\n${err.slice(0,200).join('\n')}`);
      }
      // Wait for ready notification (exactly one) within 1s after initialize
      const readySeen = await waitForLine(out, l=> l.includes('"method":"server/ready"'), 1000);
      if(!readySeen){
        server.kill();
        throw new Error(`[repro][iter=${iter}] server/ready NOT observed within 1s post-initialize (candidate flake)\nSTDOUT(last20):\n${out.slice(-20).join('\n')}\nSTDERR(last20):\n${err.slice(-20).join('\n')}`);
      }
      // Ensure not more than one ready (protocol expectation in this implementation)
      const readyCount = out.filter(l=> l.includes('"method":"server/ready"')).length;
      if(readyCount > 1){
        server.kill();
        throw new Error(`[repro][iter=${iter}] multiple server/ready emitted (${readyCount})\nSTDOUT:\n${out.filter(l=> l.includes('server/ready')).join('\n')}`);
      }
      // Wait for at least one health/check response (post or early) within 3s
      const healthIds = [healthEarlyId, healthPostId];
      const healthResponses: { id:number; status?:string }[] = [];
      const startWait = Date.now();
      while(Date.now() - startWait < 3000){
        for(const hid of healthIds){
          if(!healthResponses.some(r=> r.id === hid)){
            const line = out.find(l=> l.includes(`"id":${hid}`) && l.includes('content'));
            if(line){
              try {
                const parsed = JSON.parse(line) as JsonRpcResponse;
                const status = extractStatus(parsed.result);
                healthResponses.push({ id: hid, status });
              } catch { /* ignore parse */ }
            }
          }
        }
        if(healthResponses.length) break;
        await new Promise(r=> setTimeout(r,10));
      }
      if(!healthResponses.length){
        server.kill();
        throw new Error(`[repro][iter=${iter}] no health/check response within 3s (hang)\nSTDOUT(last30):\n${out.slice(-30).join('\n')}\nSTDERR(last30):\n${err.slice(-30).join('\n')}`);
      }
      // Validate any received health status is ok
      for(const r of healthResponses){ expect(r.status).toBe('ok'); }
      server.kill();
      // Small gap before next iteration to reduce cross-process resource contention artifacts
      await new Promise(r=> setTimeout(r,5));
    }
  }, 120_000);
});
