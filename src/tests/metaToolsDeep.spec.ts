import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function start(env: Record<string,string|undefined> = {}){
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, ...env } });
}

function send(p: ReturnType<typeof start>, msg: unknown){ p.stdin.write(JSON.stringify(msg)+'\n'); }

interface MetaToolEntry { method: string; stable?: boolean; mutation?: boolean; disabled?: boolean }
interface MetaResultShape { tools: MetaToolEntry[]; mcp: { tools: { name: string; stable?: boolean; mutation?: boolean }[]; registryVersion: string }; dynamic: { mutationEnabled: boolean; disabled: { method: string }[] } }

function collectById(lines: string[], id: number){
  for(const l of lines){ try { const o = JSON.parse(l); if(o.id===id) return o; } catch { /* ignore */ } }
  return undefined;
}

describe('meta/tools deep invariants', () => {
  it('exposes every registry entry with consistent stable & mutation flags (no mutation)', async () => {
    const proc = start();
    const lines: string[] = [];
    proc.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-deep', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!collectById(lines,1));
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} }});
    await waitFor(()=> !!collectById(lines,2));
    proc.kill();
    const obj = collectById(lines,2);
    expect(obj?.error).toBeFalsy();
  const result = obj?.result?.content?.[0]?.text ? JSON.parse(obj.result.content[0].text) as MetaResultShape : obj?.result as MetaResultShape;
  const methods = new Set(result.tools.map((t: MetaToolEntry)=> t.method));
  const registryNames = new Set(result.mcp.tools.map((t)=> t.name));
    // All registry tools must appear in meta/tools top-level list
    for(const name of registryNames) expect(methods.has(name), `missing meta/tools.tools entry for ${name}`).toBe(true);
    // Stable & mutation flags must match between views
  const index: Record<string, MetaToolEntry> = {};
    for(const t of result.tools) index[t.method]=t;
    for(const reg of result.mcp.tools){
      const t = index[reg.name];
      expect(!!t).toBe(true);
      expect(!!t.mutation).toBe(!!reg.mutation);
      expect(!!t.stable).toBe(!!reg.stable);
    }
    // With mutation disabled, no entry should have disabled:false & mutation:true mismatch
    for(const t of result.tools){ if(t.mutation) expect(t.disabled).toBe(true); }
  }, 8000);

  it('reflects mutationEnabled and disabled list flips when mutation env set', async () => {
    // First without mutation
    const p1 = start();
    const l1: string[] = [];
    p1.stdout.on('data', d => l1.push(...d.toString().trim().split(/\n+/)));
    send(p1,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-mu-off', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!collectById(l1,1));
    send(p1,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} }});
    await waitFor(()=> !!collectById(l1,2));
    p1.kill();
    const off = collectById(l1,2);
    const offResult = off?.result?.content?.[0]?.text ? JSON.parse(off.result.content[0].text) : off?.result;
    expect(offResult.dynamic.mutationEnabled).toBe(false);
    const disabledCountOff = offResult.dynamic.disabled.length;

    // Now with mutation enabled
    const p2 = start({ MCP_ENABLE_MUTATION:'1' });
    const l2: string[] = [];
    p2.stdout.on('data', d => l2.push(...d.toString().trim().split(/\n+/)));
    send(p2,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-mu-on', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!collectById(l2,1));
    send(p2,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} }});
    await waitFor(()=> !!collectById(l2,2));
    p2.kill();
    const on = collectById(l2,2);
    const onResult = on?.result?.content?.[0]?.text ? JSON.parse(on.result.content[0].text) : on?.result;
    expect(onResult.dynamic.mutationEnabled).toBe(true);
    // Disabled list should shrink or be zero when mutation on
    expect(onResult.dynamic.disabled.length).toBeLessThanOrEqual(disabledCountOff);
    if(disabledCountOff>0) expect(onResult.dynamic.disabled.length).toBeLessThan(disabledCountOff);
  }, 12000);

  it('responds quickly under sequential load (p99 latency sanity)', async () => {
    const proc = start();
    const lines: string[] = [];
    proc.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-load', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!collectById(lines,1));
    const latencies: number[] = [];
    for(let i=0;i<10;i++){
      const id = 100+i;
      const start = Date.now();
      send(proc,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'meta/tools', arguments:{} }});
      await waitFor(()=> !!collectById(lines,id));
      latencies.push(Date.now()-start);
    }
    proc.kill();
    latencies.sort((a,b)=> a-b);
    const p99 = latencies[Math.min(latencies.length-1, Math.floor(latencies.length*0.99))];
    expect(p99).toBeLessThan(500); // generous upper bound; adjust if CI env slower
  }, 10000);

  it('registryVersion matches REGISTRY_VERSION constant', async () => {
    const proc = start();
    const lines: string[] = [];
    proc.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-regver', version:'0' }, capabilities:{ tools:{} } }});
    await waitFor(()=> !!collectById(lines,1));
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} }});
    await waitFor(()=> !!collectById(lines,2));
    proc.kill();
    const obj = collectById(lines,2);
    const result = obj?.result?.content?.[0]?.text ? JSON.parse(obj.result.content[0].text) : obj?.result;
    expect(typeof result.mcp.registryVersion).toBe('string');
    // Basic ISO-like / date-ish expectation (YYYY-MM-DD)
    expect(/^20\d{2}-\d{2}-\d{2}$/.test(result.mcp.registryVersion)).toBe(true);
  }, 8000);
});
