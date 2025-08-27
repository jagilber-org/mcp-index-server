import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function start(env: Record<string,string|undefined> = {}){
  return spawn('node',[path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, ...env } });
}
function send(p: ReturnType<typeof start>, msg: unknown){ p.stdin.write(JSON.stringify(msg)+'\n'); }
function collect(p: ReturnType<typeof start>, sink: string[]){ let buf=''; p.stdout.on('data',d=>{ buf+=d.toString(); const parts=buf.split(/\n/); buf=parts.pop()!; for(const raw of parts){ const line=raw.trim(); if(line) sink.push(line); } }); }
async function waitForId(lines: string[], id: number, timeout=4000){ await waitFor(()=> lines.some(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } }), timeout); return lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('meta/tools robustness & non-hang scenarios', () => {
  it('returns promptly and includes expected stable + mutation metadata', async () => {
    const proc = start();
    const lines: string[] = []; collect(proc, lines);
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-test', version:'0.0.0' }, capabilities:{ tools:{} } }});
    await waitForId(lines,1);
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} } });
    const resp = await waitForId(lines,2,5000);
    expect(resp, 'missing meta/tools response (hang)').toBeTruthy();
    const obj = JSON.parse(resp!);
    expect(obj.error, obj.error?.message || 'meta/tools unexpectedly error').toBeFalsy();
  const payload = JSON.parse(obj.result.content[0].text) as { tools: ToolMeta[] };
  expect(Array.isArray(payload.tools)).toBe(true);
  // Basic invariants: stable tools set is subset of all tools
  const stableByFlag = payload.tools.filter(t=> t.stable).map(t=> t.method);
  for(const s of stableByFlag){ expect(payload.tools.find(t=> t.method===s)).toBeTruthy(); }
    // meta/tools itself must appear
    expect(stableByFlag.includes('meta/tools')).toBe(true);
    proc.kill();
  }, 15000);

  it('supports parallel meta/tools + dispatcher calls without deadlock', async () => {
    const proc = start();
    const lines: string[] = []; collect(proc, lines);
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-par', version:'0.0.0' }, capabilities:{ tools:{} } }});
    await waitForId(lines,1);
    for(let i=0;i<5;i++) send(proc,{ jsonrpc:'2.0', id:10+i, method:'tools/call', params:{ name:'meta/tools', arguments:{} } });
    for(let i=0;i<5;i++) send(proc,{ jsonrpc:'2.0', id:100+i, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> lines.filter(l=>{ try { const o=JSON.parse(l); return typeof o.id==='number' && ((o.id>=10&&o.id<15)||(o.id>=100&&o.id<105)); } catch { return false; } }).length===10, 8000);
    // Ensure no error responses among those ids
    for(const id of [...Array(5).keys()].map(i=>10+i).concat([...Array(5).keys()].map(i=>100+i))){
      const line = lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } });
      expect(line, `missing response for id ${id}`).toBeTruthy();
      const obj = JSON.parse(line!);
      expect(obj.error, `error for id ${id}: ${obj.error?.message}`).toBeFalsy();
    }
    proc.kill();
  }, 20000);

  it('unknown tool returns -32601 (method not found spec) quickly', async () => {
    const proc = start();
    const lines: string[] = []; collect(proc, lines);
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-unk', version:'0.0.0' }, capabilities:{ tools:{} } }});
    await waitForId(lines,1);
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'__no_such_tool__', arguments:{} } });
    const resp = await waitForId(lines,2,4000);
    expect(resp).toBeTruthy();
    const obj = JSON.parse(resp!);
    expect(obj.error).toBeTruthy();
    expect(obj.error.code).toBe(-32601);
    proc.kill();
  }, 10000);

  it('mutation tools absent / flagged disabled when MCP_ENABLE_MUTATION not set', async () => {
    const proc = start({ MCP_ENABLE_MUTATION: undefined });
    const lines: string[] = []; collect(proc, lines);
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'meta-mut', version:'0.0.0' }, capabilities:{ tools:{} } }});
    await waitForId(lines,1);
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} } });
    const resp = await waitForId(lines,2,4000);
  const payload = JSON.parse(JSON.parse(resp!).result.content[0].text) as { tools: ToolMeta[] };
  const mutationDisabled = payload.tools.filter(t=> t.mutation && t.disabled);
    // At least one mutation tool should be reported disabled (e.g., instructions/add)
    expect(mutationDisabled.length).toBeGreaterThan(0);
    proc.kill();
  }, 12000);
});

interface ToolMeta { method: string; stable?: boolean; mutation?: boolean; disabled?: boolean }
