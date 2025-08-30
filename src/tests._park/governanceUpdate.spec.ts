import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { parseToolPayload, ensureDir, ensureJsonReadable, waitForServerReady, getResponse } from './testUtils';
import { waitForDist } from './distReady';

const instructionsDir = path.join(process.cwd(),'instructions');

async function startServer(mutation:boolean){
  // Ensure dist build present (handles race when build just cleaned dist)
  await waitForDist();
  const distServer = path.join(__dirname, '../../dist/server/index.js');
  return spawn('node', [distServer], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION: mutation? '1':'', MCP_LOG_VERBOSE:'' } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
// Collect the last JSON line with matching id; ignore non-JSON or sentinel strings
// collect helper no longer needed (using getResponse + parseToolPayload on envelope JSON)

describe('instructions/governanceUpdate', () => {
  it('patches owner + status and performs version bump', async () => {
  ensureDir(instructionsDir);
    const id='gov_update_sample';
    const file=path.join(instructionsDir, id + '.json');
    const base={ id, title:'Governance Update Sample', body:'Line1 summary', priority:50, audience:'all', requirement:'optional', categories:['testing'] };
  fs.writeFileSync(file, JSON.stringify(base,null,2));
  // Ensure the freshly written file is fully flushed & readable before server loads it
  await ensureJsonReadable(file, 4000);
  const server = await startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
  // Deterministic handshake (initialize + meta/tools + list probe)
  await waitForServerReady(server, out, { initId: 6001, metaId: 6002, probeList: true, listId: 6003 });
  // First list already performed by readiness probe (id 6003). Perform an explicit pre-update list for clarity.
  send(server,{ jsonrpc:'2.0', id:6004, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
  const beforeEnv = await getResponse(out,6004,6000);
  // Extract tool payload for list
  const beforeObj = parseToolPayload<{ items: { id:string; version?:string }[] }>(JSON.stringify(beforeEnv));
  if(!beforeObj) throw new Error('missing beforeObj payload');
  const beforeEntry = beforeObj.items.find(x=> x.id===id);
    expect(beforeEntry).toBeTruthy();
    const prevVersion = beforeEntry?.version;
    // governanceUpdate patch
  send(server,{ jsonrpc:'2.0', id:6005, method:'tools/call', params:{ name:'instructions/governanceUpdate', arguments:{ id, owner:'team:alpha', status:'approved', bump:'patch' } }});
  const updEnv = await getResponse(out,6005,6000);
  const updObj = parseToolPayload<{ changed:boolean; owner:string; status:string; version:string }>(JSON.stringify(updEnv));
  if(!updObj) throw new Error('missing updObj payload');
    expect(updObj.changed).toBe(true);
    expect(updObj.owner).toBe('team:alpha');
    expect(updObj.version).not.toBe(prevVersion);
    // list again
  send(server,{ jsonrpc:'2.0', id:6006, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
  const afterEnv = await getResponse(out,6006,6000);
  const afterObj = parseToolPayload<{ items:{ id:string; owner?:string; status?:string; version?:string }[] }>(JSON.stringify(afterEnv));
  if(!afterObj) throw new Error('missing afterObj payload');
  const afterEntry = afterObj.items.find(x=> x.id===id);
    expect(afterEntry?.owner).toBe('team:alpha');
    expect(afterEntry?.status).toBe('approved');
    expect(afterEntry?.version).toBe(updObj.version);
    // idempotent second call
  send(server,{ jsonrpc:'2.0', id:6007, method:'tools/call', params:{ name:'instructions/governanceUpdate', arguments:{ id, owner:'team:alpha', status:'approved', bump:'none' } }});
  const secondEnv = await getResponse(out,6007,6000);
  const second = parseToolPayload<{ changed:boolean }>(JSON.stringify(secondEnv));
    expect(second?.changed).toBe(false);
    server.kill();
  }, 10000);
});
