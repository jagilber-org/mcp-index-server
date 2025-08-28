import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForDist } from './distReady';
import { getResponse } from './testUtils';

// Goal: aggressively probe conditions closer to real MCP clients that reportedly see a health/check hang.
// Scenarios covered:
// 1. Pipelined initialize + immediate health/check (no wait for init response).
// 2. Burst of 100 health/check requests without awaiting (pipelined) – verify all return.
// 3. Stdout backpressure simulation: send requests BEFORE attaching stdout reader (simulate slow/blocked client reader) then attach and collect.
// 4. Mixed workload: interleave health/check with meta/tools & metrics/snapshot to see if other handlers starve health.
// Each scenario times individual responses; any single timeout constitutes a reproduction candidate.

interface RpcEnv { id?: number; result?: unknown; error?: { code: number; message: string }; __error?: string }

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_HEALTH_MIXED_DIAG:'1' } });
}

function collect(stream: NodeJS.ReadableStream, sink: string[]){
  let buf='';
  stream.on('data', d=>{
    buf += d.toString();
    const parts = buf.split(/\n/);
    buf = parts.pop()!;
    for(const raw of parts){ const line = raw.trim(); if(line) sink.push(line); }
  });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

async function get(id: number, lines: string[], timeoutMs: number){
  return await getResponse(lines, id, timeoutMs) as RpcEnv;
}

const HEALTH = { method: 'tools/call', params: { name: 'health/check', arguments: {} } };

const STRESS = process.env.MCP_STRESS_DIAG === '1';
describe('health/check hang exploration (aggressive)', () => {
  it('pipelined initialize + immediate health/check (no wait for init ack)', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    const t0 = Date.now();
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18' } });
    send(server,{ jsonrpc:'2.0', id:2, ...HEALTH });
  await get(1, lines, 5000); // wait for initialize ack (discard)
    const health = await get(2, lines, 5000);
    const dtHealth = Date.now() - t0;
    if(!health.result){
      throw new Error(`Pipelined health missing result (error=${JSON.stringify(health.error)})`);
    }
    expect(dtHealth).toBeLessThan(5000); // hang would exceed
    server.kill();
  }, 12000);

  it('burst 100 pipelined health/check calls all respond', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    send(server,{ jsonrpc:'2.0', id:0, method:'initialize', params:{} });
    await get(0, lines, 4000);
    const count = 100;
    const sendTimes: Record<number, number> = {};
    for(let i=1;i<=count;i++){
      const id = i;
      sendTimes[id] = Date.now();
      send(server,{ jsonrpc:'2.0', id, ...HEALTH });
    }
    // Collect all in parallel
  const results: RpcEnv[] = await Promise.all(Array.from({ length: count }, (_,i)=> get(i+1, lines, 8000).catch(e=>({ __error: String(e), id: i+1 }) as RpcEnv)));
  const missing = results.filter(r=> r.__error);
    if(missing.length){
      throw new Error(`Missing/timeout responses for ids: ${missing.map(m=>m.id).join(', ')}`);
    }
    // latency stats
    const lats = results.map(r=> Date.now() - sendTimes[(r as RpcEnv).id!]);
    const p95 = quantile(lats,0.95);
    const max = Math.max(...lats);
    // Allow slower under load but flag extreme
    expect(max).toBeLessThan(8000);
    // Log metrics to stderr for forensic review (won't fail tests)
    // eslint-disable-next-line no-console
    console.error(`[healthExploration][burst] count=${count} p95=${p95}ms max=${max}ms`);
    server.kill();
  }, 20000);

  it('stdout backpressure simulation (delay reader) still returns health responses', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; // intentionally NOT collecting yet
    // Send initialize + 10 health calls before attaching reader
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
    for(let i=2;i<=11;i++) send(server,{ jsonrpc:'2.0', id:i, ...HEALTH });
    // Wait 2 seconds simulating a slow client that hasn't begun reading
    await new Promise(r=>setTimeout(r,2000));
    collect(server.stdout, lines);
    // Now await all
    await get(1, lines, 6000);
    const waits = [] as RpcEnv[];
    for(let i=2;i<=11;i++) waits.push(await get(i, lines, 6000));
    const errors = waits.filter(r=>!r.result);
    if(errors.length){
      throw new Error(`Backpressure scenario produced errors: ${errors.map(e=>`${e.id}:${e.error?.code}`).join(',')}`);
    }
    server.kill();
  }, 15000);

  const maybeIt = STRESS ? it : it.skip; // gate only heavier mixed/backpressure style cases
  maybeIt('mixed workload (health interleaved with meta/tools & metrics/snapshot)', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
    await get(1, lines, 4000);
    const ops = 30;
    const ids: number[] = [];
    let idCounter = 2;
    for(let i=0;i<ops;i++){
      // sequence: health, metrics, health, meta/tools
      send(server,{ jsonrpc:'2.0', id:idCounter, ...HEALTH }); ids.push(idCounter++);
      send(server,{ jsonrpc:'2.0', id:idCounter, method:'tools/call', params:{ name:'metrics/snapshot', arguments:{} } }); ids.push(idCounter++);
      send(server,{ jsonrpc:'2.0', id:idCounter, ...HEALTH }); ids.push(idCounter++);
      send(server,{ jsonrpc:'2.0', id:idCounter, method:'tools/call', params:{ name:'meta/tools', arguments:{} } }); ids.push(idCounter++);
    }
    const deadline = 12000;
  const responses: RpcEnv[] = await Promise.all(ids.map(i=> get(i, lines, deadline).catch(e=>({ __error: String(e), id: i } as RpcEnv))));
  const timeouts = responses.filter(r=> r.__error);
    if(timeouts.length){
      throw new Error(`Mixed workload timeouts for ids: ${timeouts.map(t=>t.id).join(', ')}`);
    }
    server.kill();
  }, 25000);

  it('extreme stdout backpressure (hundreds of large responses queued before reader) still returns health', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; // will attach reader late
    // initialize + do NOT attach stdout reader yet
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
    // Craft many large instructions/query style calls to inflate outbound buffer.
    // Use meta/tools (moderate) plus health plus metrics snapshot to diversify.
    // Also dispatch a health request early whose id we'll verify after drain.
    const LARGE_COUNT = 120; // chosen to likely exceed default pipe buffer (~64KB) depending on response size
    send(server,{ jsonrpc:'2.0', id:2, ...HEALTH });
    let nextId = 3;
    for(let i=0;i<LARGE_COUNT;i++){
      // alternate heavy-ish calls; meta/tools can be sizable; also request metrics/snapshot
      send(server,{ jsonrpc:'2.0', id: nextId++, method:'tools/call', params:{ name:'meta/tools', arguments:{} } });
      send(server,{ jsonrpc:'2.0', id: nextId++, method:'tools/call', params:{ name:'metrics/snapshot', arguments:{} } });
      // insert additional health probes every 20 iterations
      if(i % 20 === 0){ send(server,{ jsonrpc:'2.0', id: nextId++, ...HEALTH }); }
    }
    // Delay reader longer than earlier scenario to try to force server-side write blocking
    await new Promise(r=>setTimeout(r, 4000));
    collect(server.stdout, lines);
    // Now attempt to retrieve critical early ids first
    await get(1, lines, 10000); // initialize
    const earlyHealth = await get(2, lines, 10000);
    if(!earlyHealth.result){
      throw new Error(`Early health (id 2) missing result under extreme backpressure: ${JSON.stringify(earlyHealth.error)}`);
    }
    // Fetch remaining ids best-effort; any timeout is a reproduction candidate
    const maxId = nextId - 1;
    const pendingIds = [] as number[];
    for(let id=3; id<=maxId; id++){ pendingIds.push(id); }
    const results = await Promise.all(pendingIds.map(id => get(id, lines, 12000).catch(e=>({ __error:String(e), id }) as RpcEnv)));
    const timeouts = results.filter(r=> (r as RpcEnv).__error);
    if(timeouts.length){
      throw new Error(`Extreme backpressure timeouts for ids: ${timeouts.map(t=>t.id).join(',')}`);
    }
    server.kill();
  }, 60000);

  maybeIt('saturation with large mutation payloads (instructions/add w/ large bodies) interleaved with health', async () => {
    await waitForDist();
    const server = startServer();
    const lines: string[] = []; collect(server.stdout, lines);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{} });
    await get(1, lines, 5000);
    // Generate large body (~8KB) to inflate response payloads; vary id to avoid collisions
    const largeBody = 'X'.repeat(8*1024);
    const cycles = 60; // 60 cycles * (3 requests) -> 180 ops
    let idCounter = 2;
    const healthIds: number[] = [];
    for(let c=0;c<cycles;c++){
      const entryId = `sat_${Date.now()}_${c}`;
      // health probe
      send(server,{ jsonrpc:'2.0', id:idCounter, ...HEALTH }); healthIds.push(idCounter); idCounter++;
      // mutation add (overwrite true so repeated ids ok, but we give unique ids anyway)
      send(server,{ jsonrpc:'2.0', id:idCounter, method:'tools/call', params:{ name:'instructions/add', arguments:{ entry:{ id: entryId, title: entryId, body: largeBody, priority: 10, audience:'all', requirement:'optional', categories:['sat'] }, overwrite:true, lax:true } } }); idCounter++;
      // another health for tighter interleave
      send(server,{ jsonrpc:'2.0', id:idCounter, ...HEALTH }); healthIds.push(idCounter); idCounter++;
    }
    // Collect all health responses; failure of any indicates potential starvation
    const healthEnvs = await Promise.all(healthIds.map(id => get(id, lines, 15000).catch(e=>({ __error:String(e), id }) as RpcEnv)));
    const failed = healthEnvs.filter(e=> e.__error || !e.result);
    if(failed.length){
      throw new Error(`Health starvation under mutation saturation for ids: ${failed.map(f=>f.id).join(',')}`);
    }
    server.kill();
  }, 90000);
});

function quantile(arr: number[], q: number){
  if(!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = (sorted.length -1)*q;
  const lo = Math.floor(idx); const hi = Math.ceil(idx);
  if(lo === hi) return sorted[lo];
  const w = idx - lo; return sorted[lo]*(1-w)+sorted[hi]*w;
}
