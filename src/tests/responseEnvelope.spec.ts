import { describe, it, expect } from 'vitest';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';
import { spawn } from 'child_process';
import path from 'path';

// Robust line collector to avoid partial JSON line parsing (mirrors mcpProtocol.spec)
function attachLineCollector(stream: NodeJS.ReadableStream, sink: string[]) {
  let buffer = '';
  stream.on('data', d => {
    buffer += d.toString();
    const parts = buffer.split(/\n/);
    buffer = parts.pop()!;
    for (const p of parts) {
      const line = p.trim();
      if (line) sink.push(line);
    }
  });
}

function start(flag: boolean){
  return spawn('node',[path.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_FLAG_RESPONSE_ENVELOPE_V1: flag? '1':'0' }});
}

function send(p: ReturnType<typeof start>, msg: Record<string,unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }

function collect(out: string[], id: number){ return out.filter(l=> { try { const o=JSON.parse(l); return o.id===id; } catch { return false; } }).pop(); }

describe('response envelope flag (deprecated behavior retained as no-op)', () => {
  it('returns direct tools/call payload when flag disabled', async () => {
    const proc = start(false);
    const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await new Promise(r=> setTimeout(r,80));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }});
    await new Promise(r=> setTimeout(r,50));
  send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'health/check', arguments:{} } });
    // wait for id:2
  await waitFor(()=> !!collect(out,2), 5000);
  const respLine = collect(out,2);
    expect(respLine).toBeTruthy();
    const obj = JSON.parse(respLine!);
  const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
  if(text){ const parsed = JSON.parse(text); expect(parsed.version).toBeTruthy(); }
    proc.kill();
  }, 4000);

  it('wraps response when flag enabled (env var)', async () => {
    const proc = start(true);
    const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await new Promise(r=> setTimeout(r,80));
    send(proc,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }});
    await new Promise(r=> setTimeout(r,50));
  send(proc,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'health/check', arguments:{} } });
  await waitFor(()=> !!collect(out,11), 5000);
  let respLine = collect(out,11);
  if(!respLine){ // fallback passive delay then retry collect (rare line-buffer delay)
    await new Promise(r=> setTimeout(r,150));
    respLine = collect(out,11);
  }
    expect(respLine).toBeTruthy();
    const obj = JSON.parse(respLine!);
  // Envelope removed in 1.0.0 simplification: expect direct tools/call shape
  const inner = obj.result?.content?.[0]?.text; expect(inner).toBeTruthy();
  if(inner){ const parsed = JSON.parse(inner); expect(parsed && (parsed.status || parsed.version)).toBeTruthy(); }
    proc.kill();
  }, 4000);

  it('returns primitive payload JSON-encoded in content[0].text', async () => {
    const proc = start(true);
    const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await new Promise(r=> setTimeout(r,80));
    send(proc,{ jsonrpc:'2.0', id:30, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }});
    await new Promise(r=> setTimeout(r,50));
  send(proc,{ jsonrpc:'2.0', id:31, method:'tools/call', params:{ name:'test/primitive', arguments:{} } });
  await waitFor(()=> !!collect(out,31), 5000);
  let line = collect(out,31);
  if(!line){ await new Promise(r=> setTimeout(r,150)); line = collect(out,31); }
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
  // Primitive test tool returns primitive number directly now (no envelope)
  expect(obj.result?.content).toBeTruthy();
  const txt = obj.result?.content?.[0]?.text; expect(txt).toBeTruthy();
  if(txt){ const parsed: unknown = JSON.parse(txt); let val: unknown = parsed; if(parsed && typeof parsed==='object' && 'data' in (parsed as Record<string,unknown>)){ val = (parsed as Record<string,unknown>).data; } expect(val).toBe(42); }
    proc.kill();
  }, 4000);

  it('flags.json response_envelope_v1 ignored (still direct shape)', async () => {
    // Create temporary flags file
    const fs = await import('fs');
    const os = await import('os');
    const pathMod = await import('path');
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(),'flags-test-'));
    const file = pathMod.join(dir,'flags.json');
    fs.writeFileSync(file, JSON.stringify({ response_envelope_v1: true }));
    const proc = spawn('node',[pathMod.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_FLAGS_FILE: file } });
  const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await new Promise(r=> setTimeout(r,80));
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:40, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }})+'\n');
    await new Promise(r=> setTimeout(r,50));
  proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:41, method:'tools/call', params:{ name:'health/check', arguments:{} } })+'\n');
  await waitFor(()=> !!collect(out,41), 5000);
  let respLine = collect(out,41);
  if(!respLine){ await new Promise(r=> setTimeout(r,150)); respLine = collect(out,41); }
    expect(respLine).toBeTruthy();
    const obj = JSON.parse(respLine!);
  // Envelope file flag ignored; still legacy direct shape
  const inner2 = obj.result?.content?.[0]?.text; expect(inner2).toBeTruthy();
    proc.kill();
  }, 5000);

  it('env var overrides flags file (disables) - still direct shape', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const pathMod = await import('path');
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(),'flags-test-'));
    const file = pathMod.join(dir,'flags.json');
    fs.writeFileSync(file, JSON.stringify({ response_envelope_v1: true }));
    const proc = spawn('node',[pathMod.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_FLAGS_FILE: file, MCP_FLAG_RESPONSE_ENVELOPE_V1: '0' } });
  const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await new Promise(r=> setTimeout(r,80));
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:50, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } }})+'\n');
    await new Promise(r=> setTimeout(r,50));
  proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:51, method:'tools/call', params:{ name:'health/check', arguments:{} } })+'\n');
  await waitFor(()=> !!collect(out,51), 5000);
  let respLine = collect(out,51);
  if(!respLine){ await new Promise(r=> setTimeout(r,150)); respLine = collect(out,51); }
    expect(respLine).toBeTruthy();
    const obj = JSON.parse(respLine!);
  // Should be legacy (no envelope) -> we still receive tools/call shape
  const txt = obj.result?.content?.[0]?.text; expect(txt).toBeTruthy(); if(txt){ const parsed = JSON.parse(txt); expect(parsed.version).toBeTruthy(); }
    proc.kill();
  }, 5000);
});
