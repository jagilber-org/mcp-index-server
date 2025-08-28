import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForDist } from './distReady';

interface RpcEnvelope { id:number; result?:unknown; error?:{ code:number; message:string }; }

function startServer(){
  const exe = process.execPath;
  const entry = path.join(process.cwd(),'dist','server','index.js');
  const child = spawn(exe, [entry], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
  return child;
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

function collect(proc: ReturnType<typeof startServer>, sink: string[]){
  let buf='';
  proc.stdout.on('data', d=>{
    buf += d.toString();
    const parts = buf.split(/\n/);
    buf = parts.pop()!;
    for(const raw of parts){ const line = raw.trim(); if(line) sink.push(line); }
  });
}

function parse(line: string): RpcEnvelope | undefined { try { return JSON.parse(line); } catch { return undefined; } }

function percentile(arr:number[], p:number){
  if(!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = Math.min(sorted.length-1, Math.floor(p/100 * (sorted.length-1)));
  return sorted[idx];
}

const STRESS = process.env.MCP_STRESS_DIAG === '1';
describe('multi-process health/check stress (attempt hang reproduction)', () => {
  const maybeIt = STRESS ? it : it.skip;
  maybeIt('escalated: 6 servers parallel health bursts + diagnostics (block + microtaskFlood + memoryPressure) remain responsive', async () => {
    await waitForDist();
  const SERVER_COUNT = 6; // escalate CPU scheduling contention
  const HEALTH_PER_SERVER = 60; // total 360 health calls
  const BLOCK_EVERY = 12; // interleave blocking diagnostic calls
  const BLOCK_MS = 55; // slightly longer busy loop
  const MICRO_FLOOD_EVERY = 20; // schedule microtask flooding
  const MICRO_FLOOD_COUNT = 8_000; // moderate microtask pressure per invocation
  const MEM_PRESSURE_EVERY = 30; // inject memory allocations sporadically
  const MEM_MB = 32; // 32MB transient allocation
    const servers = Array.from({ length: SERVER_COUNT }, ()=> startServer());
    const outputs: string[][] = servers.map(()=> []);
    servers.forEach((s,i)=> collect(s, outputs[i]));

    // initialize all
    servers.forEach((s,i)=> send(s,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:`mp-health-${i}`, version:'0' }, capabilities:{ tools:{} } } }));
    const initDeadline = Date.now() + 5000;
    for(let i=0;i<servers.length;i++){
      while(Date.now() < initDeadline){
        if(outputs[i].some(l=> parse(l)?.id === 1)) break;
        await new Promise(r=> setTimeout(r,25));
      }
      if(!outputs[i].some(l=> parse(l)?.id === 1)) throw new Error(`server ${i} failed to initialize`);
    }

    // Fire bursts per server
    const sendTimes: Record<number, number> = {};
    const idBase = 10_000; // base offset to avoid collisions across servers
    servers.forEach((s,si)=>{
      for(let n=0;n<HEALTH_PER_SERVER;n++){
        const id = idBase * (si+1) + n; // unique id per server
        // Interleave a diagnostics/block before some health requests to create synchronous CPU contention inside that process
        if(n % BLOCK_EVERY === 0){
          const bid = idBase * (si+1) + (HEALTH_PER_SERVER + n);
          sendTimes[bid] = Date.now();
          send(s,{ jsonrpc:'2.0', id: bid, method:'tools/call', params:{ name:'diagnostics/block', arguments:{ ms: BLOCK_MS } } });
        }
        if(n % MICRO_FLOOD_EVERY === 0){
          const mid = idBase * (si+1) + (HEALTH_PER_SERVER*2 + n);
            sendTimes[mid] = Date.now();
            send(s,{ jsonrpc:'2.0', id: mid, method:'tools/call', params:{ name:'diagnostics/microtaskFlood', arguments:{ count: MICRO_FLOOD_COUNT } } });
        }
        if(n % MEM_PRESSURE_EVERY === 0){
          const memid = idBase * (si+1) + (HEALTH_PER_SERVER*3 + n);
          sendTimes[memid] = Date.now();
          send(s,{ jsonrpc:'2.0', id: memid, method:'tools/call', params:{ name:'diagnostics/memoryPressure', arguments:{ mb: MEM_MB } } });
        }
        sendTimes[id] = Date.now();
        send(s,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'health/check', arguments:{} } });
      }
    });

    // Collect all responses or timeout
    const deadline = Date.now() + 15_000; // generous
    const healthDurations:number[] = [];
    let receivedHealth = 0;
    const expectedHealth = SERVER_COUNT * HEALTH_PER_SERVER;
    while(Date.now() < deadline && receivedHealth < expectedHealth){
      for(let si=0; si<servers.length; si++){
        const lines = outputs[si];
        for(const line of lines){
          const env = parse(line);
          if(!env) continue;
            // Only process if still tracked
          if(env.id in sendTimes){
            const rt = Date.now() - sendTimes[env.id];
            // health/check envelope detection (result.status==='ok')
            // Result is a tools/call envelope whose result.content[0].text is JSON string; use unknown then narrow
            const resultObj = env.result as unknown as { content?: { text?: string }[] } | undefined;
            const res = resultObj?.content?.[0]?.text;
            if(res){
              try {
                const inner = JSON.parse(res);
                if(inner && inner.status === 'ok'){
                  healthDurations.push(rt);
                  receivedHealth++;
                }
              } catch {/* ignore parse errors */}
            }
            delete sendTimes[env.id];
          }
        }
      }
      if(receivedHealth >= expectedHealth) break;
      await new Promise(r=> setTimeout(r,25));
    }

    // Cleanup
    servers.forEach(s=> s.kill());

    // Assertions
    expect(receivedHealth).toBe(expectedHealth);
    const p95 = percentile(healthDurations,95);
    const p99 = percentile(healthDurations,99);
    const max = Math.max(...healthDurations);
    // Diagnostic stderr output for trend tracking
    process.stderr.write(`[multiProcHealth] count=${healthDurations.length} p95=${p95}ms p99=${p99}ms max=${max}ms\n`);
    // Thresholds: generous upper bounds (observed << 100ms historically)
    expect(p95).toBeLessThan(1500);
    expect(max).toBeLessThan(3000); // ensure no near-hang outliers
  }, 30_000);

  maybeIt('escalated-2: synchronized diagnostic waves + higher load (8 servers, heavier microtasks/memory) remain within bounds', async () => {
    await waitForDist();
    // Heavier parameters. Goal: amplify cross-process contention + event loop microtask saturation + GC pressure.
    const SERVER_COUNT = 8; // increased server processes
    const HEALTH_PER_SERVER = 80; // 640 health calls
    const BLOCK_EVERY = 10; // more frequent blocking
    const BLOCK_MS = 75; // longer busy loop
    const MICRO_FLOOD_EVERY = 15; // more frequent floods
    const MICRO_FLOOD_COUNT = 20_000; // heavier microtask pressure
    const MEM_PRESSURE_EVERY = 20; // more frequent allocations
    const MEM_MB = 64; // larger transient allocation (ensure under system limits)

    const servers = Array.from({ length: SERVER_COUNT }, ()=> startServer());
    const outputs: string[][] = servers.map(()=> []);
    servers.forEach((s,i)=> collect(s, outputs[i]));

    // initialize all
    servers.forEach((s,i)=> send(s,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:`mp-health2-${i}`, version:'0' }, capabilities:{ tools:{} } } }));
    const initDeadline = Date.now() + 7000; // slight bump for more processes
    for(let i=0;i<servers.length;i++){
      while(Date.now() < initDeadline){
        if(outputs[i].some(l=> parse(l)?.id === 1)) break;
        await new Promise(r=> setTimeout(r,25));
      }
      if(!outputs[i].some(l=> parse(l)?.id === 1)) throw new Error(`server ${i} failed to initialize (phase2)`);
    }

    // Phase 0: synchronized diagnostic wave BEFORE health to stack queued microtasks & memory pressure.
    // We deliberately fire block + microtaskFlood + memoryPressure simultaneously across all servers.
    const prepSendTimes: Record<number, number> = {};
    const PREP_BASE = 50_000; // distinct id base for phase 0
    servers.forEach((s, si)=>{
      const bid = PREP_BASE * (si+1) + 1;
      prepSendTimes[bid] = Date.now();
      send(s,{ jsonrpc:'2.0', id: bid, method:'tools/call', params:{ name:'diagnostics/block', arguments:{ ms: BLOCK_MS } } });
      const mid = PREP_BASE * (si+1) + 2;
      prepSendTimes[mid] = Date.now();
      send(s,{ jsonrpc:'2.0', id: mid, method:'tools/call', params:{ name:'diagnostics/microtaskFlood', arguments:{ count: MICRO_FLOOD_COUNT } } });
      const memid = PREP_BASE * (si+1) + 3;
      prepSendTimes[memid] = Date.now();
      send(s,{ jsonrpc:'2.0', id: memid, method:'tools/call', params:{ name:'diagnostics/memoryPressure', arguments:{ mb: MEM_MB } } });
    });

    // Immediately proceed to health bursts without waiting for completions to overlap phases.
    const sendTimes: Record<number, number> = { ...prepSendTimes };
    const idBase = 80_000; // base offset to avoid collisions across servers for phase 1
    servers.forEach((s,si)=>{
      for(let n=0;n<HEALTH_PER_SERVER;n++){
        const id = idBase * (si+1) + n; // unique id per server
        if(n % BLOCK_EVERY === 0){
          const bid = idBase * (si+1) + (HEALTH_PER_SERVER + n);
          sendTimes[bid] = Date.now();
          send(s,{ jsonrpc:'2.0', id: bid, method:'tools/call', params:{ name:'diagnostics/block', arguments:{ ms: BLOCK_MS } } });
        }
        if(n % MICRO_FLOOD_EVERY === 0){
          const mid = idBase * (si+1) + (HEALTH_PER_SERVER*2 + n);
          sendTimes[mid] = Date.now();
          send(s,{ jsonrpc:'2.0', id: mid, method:'tools/call', params:{ name:'diagnostics/microtaskFlood', arguments:{ count: MICRO_FLOOD_COUNT } } });
        }
        if(n % MEM_PRESSURE_EVERY === 0){
          const memid = idBase * (si+1) + (HEALTH_PER_SERVER*3 + n);
          sendTimes[memid] = Date.now();
          send(s,{ jsonrpc:'2.0', id: memid, method:'tools/call', params:{ name:'diagnostics/memoryPressure', arguments:{ mb: MEM_MB } } });
        }
        sendTimes[id] = Date.now();
        send(s,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'health/check', arguments:{} } });
      }
    });

    // Collect responses with extended deadline owing to heavier load
    const deadline = Date.now() + 25_000;
    const healthDurations:number[] = [];
    let receivedHealth = 0;
    const expectedHealth = SERVER_COUNT * HEALTH_PER_SERVER;
    while(Date.now() < deadline && receivedHealth < expectedHealth){
      for(let si=0; si<servers.length; si++){
        const lines = outputs[si];
        for(const line of lines){
          const env = parse(line);
          if(!env) continue;
          if(env.id in sendTimes){
            const rt = Date.now() - sendTimes[env.id];
            const resultObj = env.result as unknown as { content?: { text?: string }[] } | undefined;
            const res = resultObj?.content?.[0]?.text;
            if(res){
              try {
                const inner = JSON.parse(res);
                if(inner && inner.status === 'ok'){
                  healthDurations.push(rt);
                  receivedHealth++;
                }
              } catch {/* ignore */}
            }
            delete sendTimes[env.id];
          }
        }
      }
      if(receivedHealth >= expectedHealth) break;
      await new Promise(r=> setTimeout(r,25));
    }

    servers.forEach(s=> s.kill());

    expect(receivedHealth).toBe(expectedHealth);
    const p95 = percentile(healthDurations,95);
    const p99 = percentile(healthDurations,99);
    const max = Math.max(...healthDurations);
    process.stderr.write(`[multiProcHealth-2] count=${healthDurations.length} p95=${p95}ms p99=${p99}ms max=${max}ms\n`);
    // Keep same thresholds for signal; if exceeded we investigate.
    expect(p95).toBeLessThan(1500);
    expect(max).toBeLessThan(3000);
  }, 45_000);
});
