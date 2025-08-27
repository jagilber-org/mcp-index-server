import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'] });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

describe('metrics/snapshot', () => {
  it('captures timing for invoked tools', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
  // Wait a moment for process spin-up and perform initialize; then wait for its response deterministically
  send(server,{ jsonrpc:'2.0', id:90, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===90; } catch { return false; } }), 3000);
  // Invoke a couple of tools via tools/call (SDK will route) using dispatcher
  send(server,{ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'health/check', arguments:{} } });
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===1; } catch { return false; } }) && lines.some(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }), 3000);
    // Call metrics snapshot directly (registered as tool)
    send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'metrics/snapshot', arguments:{} } });
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===3; } catch { return false; } }), 3000);
  server.kill();
  const obj = (()=> { for(const l of lines){ try { const o = JSON.parse(l); if(o.id===3) return o; } catch { /* ignore */ } } return undefined; })();
  expect(obj).toBeTruthy();
  if(!obj) return;
    expect(obj.result?.content?.[0]?.type).toBe('text');
  const snapshot = JSON.parse(obj.result.content[0].text) as { methods: { method: string }[], features?: { features:string[]; counters:Record<string,number> } };
  expect(Array.isArray(snapshot.methods)).toBe(true);
  // Features block should exist even if empty (no INDEX_FEATURES set)
  expect(snapshot.features).toBeTruthy();
  if(snapshot.features){
    expect(Array.isArray(snapshot.features.features)).toBe(true);
    expect(typeof snapshot.features.counters).toBe('object');
  }
  // Ensure we have at least the tools we invoked
  const names = snapshot.methods.map(m => m.method);
    expect(names).toContain('instructions/dispatch');
    expect(names).toContain('health/check');
  }, 8000);
});
