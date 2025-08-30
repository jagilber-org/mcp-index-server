import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload, ensureFileExists, waitForServerReady } from './testUtils';

// Verifies INSTRUCTIONS_DIR env variable forces both load & write operations
// into the same explicit directory (pinned). Ensures add + list + persistence across restart.

function startServer(customDir: string){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { cwd: process.cwd(), env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: customDir } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines: string[], id:number){ return lines.find(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }); }
function haveId(lines:string[], id:number){ return !!findLine(lines,id); }

describe('env override INSTRUCTIONS_DIR', () => {
  it('writes, lists, and persists in custom dir', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'instr-env-'));
    // First server lifecycle
    const server1 = startServer(tmp);
    const out1: string[] = []; server1.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    // Deterministic readiness (initialize + meta/tools + list probe) using high ids
    await waitForServerReady(server1, out1, { initId: 6200, metaId: 6201, probeList: true, listId: 6202 });
    const probeLine = findLine(out1,6202);
    const probePayload = probeLine? parseToolPayload<{ count:number; items:{id:string}[] }>(probeLine): undefined;
    const baseCount = probePayload?.count || 0;
    // Add new entry with high id
    const id = 'env-dir-' + Date.now();
    send(server1,{ jsonrpc:'2.0', id:6203, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Body', priority:5, audience:'all', requirement:'optional', categories:['env'], owner:'team:env', version:'0.0.1' }, overwrite:true, lax:true } } });
    await waitFor(()=> haveId(out1,6203));
    // List after add
    send(server1,{ jsonrpc:'2.0', id:6204, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> haveId(out1,6204));
    const afterLine = findLine(out1,6204);
    const afterPayload = afterLine? parseToolPayload<{ count:number; items:{id:string}[] }>(afterLine) : undefined;
    if(!afterPayload) throw new Error('missing afterPayload');
    const idsAfter = new Set(afterPayload.items.map(i=> i.id));
    expect(idsAfter.has(id)).toBe(true);
    expect(afterPayload.count).toBeGreaterThanOrEqual(baseCount + 1);
    // Confirm file exists in custom dir (polling)
    const filePath = path.join(tmp, `${id}.json`);
    await ensureFileExists(filePath, 4000);
    server1.kill();
    // Restart second server against same dir; readiness then list
    const server2 = startServer(tmp);
    const out2: string[] = []; server2.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await waitForServerReady(server2, out2, { initId: 6210, metaId: 6211, probeList: true, listId: 6212 });
    const restartProbe = findLine(out2,6212);
    const restartPayload = restartProbe? parseToolPayload<{ count:number; items:{id:string}[] }>(restartProbe) : undefined;
    if(!restartPayload) throw new Error('missing restartPayload');
    const idsRestart = new Set(restartPayload.items.map(i=> i.id));
    expect(idsRestart.has(id)).toBe(true);
    server2.kill();
  }, 20000);
});
