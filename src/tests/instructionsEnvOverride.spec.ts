import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload } from './testUtils';

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
    const server1 = startServer(tmp);
    const out1: string[] = []; server1.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server1,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'env-override', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out1,1));

    // Baseline list
  send(server1,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> haveId(out1,2));
  const baseLine = findLine(out1,2);
  const basePayload = baseLine? parseToolPayload<{ count:number; items:{id:string}[] }>(baseLine) : undefined;
  const baseCount = basePayload?.count || 0;

    const id = 'env-dir-' + Date.now();
  send(server1,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Body', priority:5, audience:'all', requirement:'optional', categories:['env'], owner:'team:env', version:'0.0.1' }, overwrite:true, lax:true } } });
  await waitFor(()=> haveId(out1,3));

  send(server1,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> haveId(out1,4));
  const afterLine = findLine(out1,4);
  const afterPayload = afterLine? parseToolPayload<{ count:number; items:{id:string}[] }>(afterLine) : undefined;
  if(!afterPayload) throw new Error('missing afterPayload');
  const idsAfter = new Set(afterPayload.items.map(i=> i.id));
  expect(idsAfter.has(id)).toBe(true);
  expect(afterPayload.count).toBeGreaterThanOrEqual(baseCount + 1);

    // Confirm file exists in custom dir
    const filePath = path.join(tmp, `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    server1.kill();

    // Restart new process pointing to same dir -> should list same id without re-adding
    const server2 = startServer(tmp);
    const out2: string[] = []; server2.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,150));
    send(server2,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'env-override-2', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out2,10));

  send(server2,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> haveId(out2,11));
  const restartLine = findLine(out2,11);
  const restartPayload = restartLine? parseToolPayload<{ count:number; items:{id:string}[] }>(restartLine) : undefined;
  if(!restartPayload) throw new Error('missing restartPayload');
  const idsRestart = new Set(restartPayload.items.map(i=> i.id));
  expect(idsRestart.has(id)).toBe(true);

    server2.kill();
  }, 20000);
});
