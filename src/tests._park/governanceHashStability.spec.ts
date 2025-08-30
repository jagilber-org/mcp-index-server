import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload, ensureFileExists, ensureJsonReadable } from './testUtils';
const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-govhash-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function haveId(lines:string[], id:number){ return lines.some(l=> { try { const o = JSON.parse(l); return o && o.id===id; } catch { return false; } }); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }); }

describe('governance hash stability across restart', () => {
  it('hash remains identical across restart with no writes', async () => {
    const id = `hash_stability_${Date.now()}`;
    let server = startServer();
    const out1: string[] = []; server.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'hash-test1', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out1,1));
    // Add deterministic entry with explicit governance
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Hash body', priority:25, audience:'all', requirement:'optional', categories:['hash'], owner:'hash-owner', version:'1.0.1', priorityTier:'P2', semanticSummary:'Hash summary' }, overwrite:true, lax:true } } });
  await waitFor(()=> haveId(out1,2));
  send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
  await waitFor(()=> haveId(out1,3));
  const firstLine = findLine(out1,3);
  if(!firstLine) throw new Error('missing first hash resp');
  const firstParsed = firstLine? parseToolPayload<{ governanceHash?:string }>(firstLine) : undefined;
  if(!firstParsed || !firstParsed.governanceHash) throw new Error('missing first governanceHash');
  const firstHash = firstParsed.governanceHash;
    // Ensure file exists (robust polling) and is fully readable JSON before proceeding
  const targetFile = path.join(ISOLATED_DIR, `${id}.json`);
  await ensureFileExists(targetFile, 6000);
  await ensureJsonReadable(targetFile, 6000);
    server.kill();

    // Restart and compute hash again
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'hash-test2', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out2,10));
  send(server,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
  await waitFor(()=> haveId(out2,11));
  const secondLine = findLine(out2,11);
  if(!secondLine) throw new Error('missing second hash resp');
  const secondParsed = secondLine? parseToolPayload<{ governanceHash?:string }>(secondLine) : undefined;
  if(!secondParsed || !secondParsed.governanceHash) throw new Error('missing second governanceHash');
  const secondHash = secondParsed.governanceHash;
    expect(secondHash).toBe(firstHash);

    server.kill();
  }, 20000);
});
