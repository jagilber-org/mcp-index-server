import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForDist } from './distReady';
import { getResponse } from './testUtils';

// Additional diagnostic instrumentation focused on capturing subtle latency stalls or ordering anomalies
// Not a reproduction yet; builds signal surface for future hang investigations.
// Captures:
//  1. Raw timestamped transcript (stdout + stderr) with per-line high-resolution time deltas.
//  2. Event loop latency (interval drift) sampled during burst + mixed workloads.
//  3. Cross-process contention: launches two concurrent clients saturating different tool mixes.
// Success criteria: All health/check calls return < timeout; we log metrics to stderr for forensic review.

interface RpcEnv { id?: number; result?: unknown; error?: { code: number; message: string }; __error?: string }

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

async function collectBurst(server: ReturnType<typeof startServer>, count: number, baseId: number, lines: string[], timeoutMs: number){
  const HEALTH = { method: 'tools/call', params: { name: 'health/check', arguments: {} } };
  const sendTimes: Record<number, number> = {};
  for(let i=0;i<count;i++){
    const id = baseId + i;
    sendTimes[id] = performance.now();
    send(server,{ jsonrpc:'2.0', id, ...HEALTH });
  }
  const results: RpcEnv[] = [];
  for(let i=0;i<count;i++){
    const id = baseId + i;
    try { results.push(await getResponse(lines, id, timeoutMs) as unknown as RpcEnv); } catch(e){ results.push({ __error:String(e), id } as RpcEnv); }
  }
  return { results, sendTimes };
}

function quantile(arr: number[], q: number){
  if(!arr.length) return 0; const sorted=[...arr].sort((a,b)=>a-b); const idx=(sorted.length-1)*q; const lo=Math.floor(idx); const hi=Math.ceil(idx); if(lo===hi) return sorted[lo]; const w=idx-lo; return sorted[lo]*(1-w)+sorted[hi]*w;
}

// Simple event loop lag sampler
class LoopLagSampler {
  private running = false; private samples: number[] = []; private last = 0; private handle: NodeJS.Timeout | undefined;
  start(interval=25){
    if(this.running) return; this.running=true; this.last=performance.now();
    const tick = ()=>{
      if(!this.running) return; const now = performance.now(); const drift = now - this.last - interval; if(drift>0) this.samples.push(drift); this.last=now; this.handle=setTimeout(tick, interval);
    }; tick();
  }
  stop(){ this.running=false; if(this.handle) clearTimeout(this.handle); }
  stats(){ const s=this.samples; if(!s.length) return { max:0,p95:0,mean:0,count:0 }; const max=Math.max(...s); const p95=quantile(s,0.95); const mean=s.reduce((a,b)=>a+b,0)/s.length; return { max,p95,mean,count:s.length }; }
}

function attachTranscript(proc: ReturnType<typeof startServer>, sink: string[], prefix: string){
  const push = (src: string, data: Buffer)=>{
    const now = performance.now();
    const lines = data.toString().split(/\n/);
    for(const raw of lines){ const line = raw.trim(); if(line){ sink.push(`${now.toFixed(3)}\t${prefix}\t${src}\t${line}`); } }
  };
  proc.stdout.on('data', d=> push('stdout', d));
  proc.stderr.on('data', d=> push('stderr', d));
}

// getResponse already imported statically above; no dynamic import to avoid top-level await

describe('health/check instrumentation diagnostics', () => {
  it('captures burst latency distribution + loop lag + raw transcript', async () => {
    await waitForDist();
    const server = startServer();
    const rawLines: string[] = []; // transcript lines with timestamps
    const rpcLines: string[] = []; // parsed stdout JSON only
    // raw transcript collection
    attachTranscript(server, rawLines, 'srv');
    // also collect pure stdout JSON lines for RPC matching
    server.stdout.on('data', d=>{ const parts=d.toString().split(/\n/); for(const p of parts){ const t=p.trim(); if(t) rpcLines.push(t); } });
    // init
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
    await getResponse(rpcLines,1,4000);
    const sampler = new LoopLagSampler(); sampler.start(25);
    const { results, sendTimes } = await collectBurst(server, 120, 1000, rpcLines, 8000);
    sampler.stop();
    const failures = results.filter(r=> r.__error || !r.result);
    if(failures.length){
      // eslint-disable-next-line no-console
      console.error('[healthDiag][burst] failures', failures.map(f=>f.id));
    }
    const lats = results.filter(r=> !r.__error && r.result).map(r=> performance.now() - sendTimes[r.id!]);
    const p95 = quantile(lats,0.95); const max=Math.max(...lats); const mean = lats.reduce((a,b)=>a+b,0)/ (lats.length||1);
    const lagStats = sampler.stats();
    // eslint-disable-next-line no-console
    console.error(`[healthDiag][burst] n=${results.length} ok=${lats.length} p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms mean=${mean.toFixed(1)}ms loopLagMax=${lagStats.max.toFixed(2)} loopLagP95=${lagStats.p95.toFixed(2)} samples=${lagStats.count}`);
    expect(max).toBeLessThan(8000);
    // Provide condensed ordering anomaly heuristic: ensure ids are monotonic in transcript appearance (best effort)
    const firstSeen: Record<string, number> = {};
    rawLines.forEach((l,idx)=>{ const m = l.match(/"id":(\d+)/); if(m && !(m[1] in firstSeen)){ firstSeen[m[1]] = idx; } });
    const outOfOrder: string[] = [];
    const ids = Object.keys(firstSeen).map(Number).sort((a,b)=>a-b);
    for(let i=1;i<ids.length;i++){ if(firstSeen[String(ids[i])] < firstSeen[String(ids[i-1])]) outOfOrder.push(`${ids[i-1]}->${ids[i]}`); }
    if(outOfOrder.length){ console.error('[healthDiag][ordering] anomalies', outOfOrder.slice(0,10)); }
    server.kill();
  }, 25000);

  it('dual-client contention: two parallel bursts maintain responsiveness', async () => {
    await waitForDist();
    const server = startServer();
    const rpcLines: string[] = []; server.stdout.on('data', d=>{ const parts=d.toString().split(/\n/); for(const p of parts){ const t=p.trim(); if(t) rpcLines.push(t); } });
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
    await getResponse(rpcLines,1,4000);
    // Emulate two clients by interleaving ids from two ranges
    const total = 160; const half = total/2; const HEALTH = { method:'tools/call', params:{ name:'health/check', arguments:{} } };
    const sendTimes: Record<number, number> = {};
    for(let i=0;i<half;i++){
      const idA = 1000 + i; const idB = 2000 + i;
      sendTimes[idA] = performance.now(); sendTimes[idB] = performance.now();
      send(server,{ jsonrpc:'2.0', id:idA, ...HEALTH });
      send(server,{ jsonrpc:'2.0', id:idB, ...HEALTH });
    }
    // collect all
    const allIds = [...Array.from({length:half},(_,i)=>1000+i), ...Array.from({length:half},(_,i)=>2000+i)];
    const envelopes: RpcEnv[] = [];
    for(const id of allIds){ try { envelopes.push(await getResponse(rpcLines,id,8000) as unknown as RpcEnv); } catch(e){ envelopes.push({ __error:String(e), id } as RpcEnv); } }
    const failures = envelopes.filter(e=> e.__error || !e.result);
    if(failures.length){ console.error('[healthDiag][dual] failures', failures.map(f=>f.id)); }
    const lats = envelopes.filter(e=> !e.__error && e.result).map(e=> performance.now() - sendTimes[e.id!]);
    const p95 = quantile(lats,0.95); const max = Math.max(...lats); const mean = lats.reduce((a,b)=>a+b,0)/(lats.length||1);
    console.error(`[healthDiag][dual] total=${total} p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms mean=${mean.toFixed(1)}ms`);
    expect(max).toBeLessThan(8000);
    server.kill();
  }, 30000);
});
