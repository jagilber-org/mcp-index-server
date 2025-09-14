#!/usr/bin/env node
// Performance baseline collector for MCP Index Server
// Captures latency statistics for selected tools using the portable client abstraction.
// Output: data/perf-baseline-<ISO>.json with schema:
// {
//   timestamp, commit, nodeVersion, platform, samples: { toolName: { count, durationsMs: [], min, max, mean, p50, p90, p95, p99 } },
//   handshake: { handshakeMs, toolsListedMs },
//   config: { iterationsPerTool, warmup, tools }
// }

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// (no __filename needed)

async function loadPortable(){
  const mod = await import('../portable-mcp-client/client-lib.mjs');
  return mod;
}

function quantile(sorted, q){
  if(!sorted.length) return 0; if(q<=0) return sorted[0]; if(q>=1) return sorted[sorted.length-1];
  const idx = (sorted.length-1)*q; const lo = Math.floor(idx); const hi = Math.ceil(idx);
  if(lo===hi) return sorted[lo];
  const w = idx - lo; return sorted[lo]*(1-w) + sorted[hi]*w;
}

function summarize(durations){
  if(!durations.length) return { count:0, durationsMs:[], min:0,max:0,mean:0,p50:0,p90:0,p95:0,p99:0 };
  const sorted = durations.slice().sort((a,b)=>a-b);
  const sum = durations.reduce((a,b)=>a+b,0);
  return {
    count: durations.length,
    durationsMs: durations,
    min: sorted[0],
    max: sorted[sorted.length-1],
    mean: +(sum/durations.length).toFixed(2),
    p50: +quantile(sorted,0.50).toFixed(2),
    p90: +quantile(sorted,0.90).toFixed(2),
    p95: +quantile(sorted,0.95).toFixed(2),
    p99: +quantile(sorted,0.99).toFixed(2)
  };
}

async function main(){
  const iterationsPerTool = parseInt(process.env.PERF_ITER || '25',10);
  const warmup = parseInt(process.env.PERF_WARMUP || '5',10);
  const tools = (process.env.PERF_TOOLS || 'instructions/health,graph/export,help/overview').split(',').map(s=>s.trim()).filter(Boolean);
  const { connect } = await loadPortable();
  const command = 'node';
  const args = ['dist/server/index.js'];
  const c = await connect({ command, args, name:'perf-baseline-client', version:'1.0.0', envOverrides:{}, capture:false, opTrace:false });
  const client = c.client; const close = c.close;
  const metrics = {};
  // Optional warmup (doesn't record)
  for(const t of tools){
    for(let i=0;i<warmup;i++){
      try { await client.callTool({ name:t, arguments: t==='graph/export'? { maxEdges:50 }: {} }); } catch { /* ignore warmup errors */ }
    }
  }
  const memoryStats = {}; // per-tool memory snapshots (rss array)
  for(const t of tools){
    const durations = [];
    const rssValues = [];
    for(let i=0;i<iterationsPerTool;i++){
      const start = performance.now();
      let ok = true;
      try {
        await client.callTool({ name:t, arguments: t==='graph/export'? { maxEdges:50 }: {} });
      } catch(e){ ok = false; }
      const dur = performance.now()-start;
      durations.push(+dur.toFixed(2));
      try { const mem = process.memoryUsage(); rssValues.push(mem.rss); } catch { /* ignore */ }
      if(process.env.PERF_TRACE==='1') process.stderr.write(`[perf] ${t} iter=${i+1}/${iterationsPerTool} ms=${dur.toFixed(2)} ok=${ok}\n`);
    }
    metrics[t] = summarize(durations);
    if(rssValues.length){
      const sortedR = rssValues.slice().sort((a,b)=>a-b);
      const rssMean = Math.round(rssValues.reduce((a,b)=>a+b,0)/rssValues.length);
      memoryStats[t] = {
        samples: rssValues.length,
        rssMin: sortedR[0],
        rssMax: sortedR[sortedR.length-1],
        rssMean,
        rssDelta: sortedR[sortedR.length-1]-sortedR[0]
      };
    }
  }
  await close();
  // Enrich metadata
  let commit = 'unknown';
  try { commit = fs.readFileSync(path.join(process.cwd(), '.git', 'HEAD'),'utf8').trim();
    if(commit.startsWith('ref:')){
      const refPath = commit.split(' ')[1];
      const abs = path.join(process.cwd(), '.git', refPath);
      if(fs.existsSync(abs)) commit = fs.readFileSync(abs,'utf8').trim();
    }
  } catch { /* ignore */ }
  // Hash a subset of interesting env vars for reproducibility without leaking sensitive values
  const ENV_KEYS = Object.keys(process.env).filter(k=> /^MCP_|^NODE_ENV$/.test(k)).sort();
  const envSnapshot = {};
  for(const k of ENV_KEYS){ envSnapshot[k] = process.env[k]; }
  let envHash = 'na';
  try {
    const crypto = require('crypto');
    envHash = crypto.createHash('sha256').update(JSON.stringify(envSnapshot),'utf8').digest('hex').slice(0,16);
  } catch { /* ignore */ }
  const out = {
    timestamp: new Date().toISOString(),
    commit,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    handshake: c.handshake,
    config: { iterationsPerTool, warmup, tools },
    samples: metrics,
    memory: memoryStats,
    env: { keys: ENV_KEYS, hash: envHash }
  };
  const outDir = path.join(process.cwd(),'data');
  fs.mkdirSync(outDir,{ recursive:true });
  const fname = path.join(outDir, `performance-baseline-${new Date().toISOString().replace(/[:]/g,'-')}.json`);
  fs.writeFileSync(fname, JSON.stringify(out,null,2));
  console.log('[perf-baseline] wrote', fname);
  // Summary print
  for(const t of tools){
    const m = metrics[t];
    console.log(`[perf] ${t} count=${m.count} p50=${m.p50} p95=${m.p95} max=${m.max} mean=${m.mean}`);
  }
}

main().catch(e=>{ console.error('[perf-baseline][error]', e && e.stack || e); process.exit(1); });
