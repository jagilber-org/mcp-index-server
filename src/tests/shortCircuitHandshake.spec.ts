import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function runShort(initFrame: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const exe = process.execPath; // node
    // Use compiled dist entry (mirrors other spawn tests) – prior path pointed to non-existent src/server/index.js
    const entry = path.join(process.cwd(),'dist','server','index.js');
    const server = spawn(exe, [entry], { env:{ ...process.env, MCP_SHORTCIRCUIT:'1' } });
    const lines: string[] = [];
    let resolved = false;
    server.stdout.on('data', d => {
  d.toString('utf8').split(/\r?\n/).filter(Boolean).forEach((l: string)=> lines.push(l));
      if(lines.length >= 3 && !resolved){ resolved = true; server.kill(); resolve(lines); }
    });
    server.stderr.on('data', ()=>{});
    server.on('error', e => { if(!resolved){ resolved = true; reject(e);} });
    server.on('exit', ()=>{ if(!resolved){ resolved = true; resolve(lines);} });
    setTimeout(()=>{ try { server.stdin.write(initFrame + '\n'); } catch {/* ignore */} }, 5);
    setTimeout(()=>{ if(!resolved){ resolved = true; try { server.kill(); } catch {/* ignore */} resolve(lines); } }, 1500);
  });
}

describe('shortCircuit handshake', () => {
  it('emits initialize result then exactly one ready after', async () => {
    const lines = await runShort('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}');
    // Expect at least initialize + ready
  // Accept any line containing protocolVersion (result envelope shape may vary with minification)
  const initIndex = lines.findIndex(l => /"protocolVersion"/.test(l));
    expect(initIndex).toBeGreaterThanOrEqual(0);
    const readyIndices = lines.map((l,i)=> /server\/ready/.test(l)? i : -1).filter(i=> i!==-1);
    expect(readyIndices.length).toBe(1);
    expect(readyIndices[0]).toBeGreaterThan(initIndex);
  }, 10_000);
});
