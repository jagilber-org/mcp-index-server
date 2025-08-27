import { describe, it, expect } from 'vitest';
import { waitForServerReady, getResponse } from './testUtils';
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

// Legacy collect removed; replaced by getResponse (enforces JSON-RPC invariants)

describe('response envelope flag (deprecated behavior retained as no-op)', () => {
  it('returns direct tools/call payload when flag disabled', async () => {
    const proc = start(false);
    const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await waitForServerReady(proc, out, { initId: 5701, metaId: 5702 });
    send(proc,{ jsonrpc:'2.0', id:5703, method:'tools/call', params:{ name:'health/check', arguments:{} } });
    const env = await getResponse(out,5703,5600);
  const objUnknown: unknown = env;
  const text = (objUnknown as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text; expect(text).toBeTruthy();
    if(text){ const parsed = JSON.parse(text); expect(parsed.version || parsed.status).toBeTruthy(); }
    proc.kill();
  }, 6000);

  it('returns direct shape even when flag enabled (env var)', async () => {
    const proc = start(true);
    const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await waitForServerReady(proc, out, { initId: 5710, metaId: 5711 });
    send(proc,{ jsonrpc:'2.0', id:5712, method:'tools/call', params:{ name:'health/check', arguments:{} } });
  const envU: unknown = await getResponse(out,5712,5600);
  const inner = (envU as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text; expect(inner).toBeTruthy();
    if(inner){ const parsed = JSON.parse(inner); expect(parsed && (parsed.status || parsed.version)).toBeTruthy(); }
    proc.kill();
  }, 6000);

  it('returns primitive payload JSON-encoded in content[0].text', async () => {
    const proc = start(true);
    const out: string[]=[]; attachLineCollector(proc.stdout, out);
    await waitForDist();
    await waitForServerReady(proc, out, { initId: 5730, metaId: 5731 });
    send(proc,{ jsonrpc:'2.0', id:5732, method:'tools/call', params:{ name:'test/primitive', arguments:{} } });
  const envPrim: unknown = await getResponse(out,5732,5600);
  const txt = (envPrim as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text; expect(txt).toBeTruthy();
    if(txt){ const parsed: unknown = JSON.parse(txt); let val: unknown = parsed; if(parsed && typeof parsed==='object' && 'data' in (parsed as Record<string,unknown>)){ val = (parsed as Record<string,unknown>).data; } expect(val).toBe(42); }
    proc.kill();
  }, 6000);

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
    await waitForServerReady(proc, out, { initId: 5740, metaId: 5741 });
    send(proc,{ jsonrpc:'2.0', id:5742, method:'tools/call', params:{ name:'health/check', arguments:{} } });
  const envFlags: unknown = await getResponse(out,5742,5600);
  const inner2 = (envFlags as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text; expect(inner2).toBeTruthy();
    proc.kill();
  }, 6000);

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
    await waitForServerReady(proc, out, { initId: 5750, metaId: 5751 });
    send(proc,{ jsonrpc:'2.0', id:5752, method:'tools/call', params:{ name:'health/check', arguments:{} } });
  const envOverride: unknown = await getResponse(out,5752,5600);
  const txt = (envOverride as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text; expect(txt).toBeTruthy(); if(txt){ const parsed = JSON.parse(txt); expect(parsed.version || parsed.status).toBeTruthy(); }
    proc.kill();
  }, 6000);
});
