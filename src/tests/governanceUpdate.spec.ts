import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { waitFor } from './testUtils';
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
function collect(out:string[], id:number){
  // Scan from end for a valid JSON RPC line with matching id; ignore stray 'undefined' or log noise.
  for(let i=out.length-1;i>=0;i--){
    const raw = out[i];
    if(!raw) continue;
    const trimmed = raw.trim();
    if(!trimmed || trimmed === 'undefined') continue;
    const first = trimmed[0];
    if(first !== '{' && first !== '[') continue;
    try {
      const obj = JSON.parse(trimmed);
      if(obj && typeof obj === 'object' && 'id' in obj && (obj as { id?:unknown }).id === id){
        return trimmed;
      }
    } catch { /* ignore parse errors (partial lines) */ }
  }
  return undefined;
}

describe('instructions/governanceUpdate', () => {
  it('patches owner + status and performs version bump', async () => {
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir,{recursive:true});
    const id='gov_update_sample';
    const file=path.join(instructionsDir, id + '.json');
    const base={ id, title:'Governance Update Sample', body:'Line1 summary', priority:50, audience:'all', requirement:'optional', categories:['testing'] };
    fs.writeFileSync(file, JSON.stringify(base,null,2));
  const server = await startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    // init
    await new Promise(r=> setTimeout(r,60));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!collect(out,1));
    // list before update
  send(server,{ jsonrpc:'2.0', id:2, method:'instructions/dispatch', params:{ action:'list' } });
  await waitFor(()=> !!collect(out,2));
  // small settle delay to ensure file write flush before governanceUpdate
  await new Promise(r=> setTimeout(r,40));
    const beforeLine = collect(out,2)!; const beforeObj = JSON.parse(beforeLine).result;
    const beforeEntry = (beforeObj.items as unknown[]).find((x:unknown)=> (x as { id?:string }).id===id) as { version:string } | undefined;
    expect(beforeEntry).toBeTruthy();
    const prevVersion = beforeEntry?.version;
    // governanceUpdate patch
    send(server,{ jsonrpc:'2.0', id:3, method:'instructions/governanceUpdate', params:{ id, owner:'team:alpha', status:'approved', bump:'patch' } });
    await waitFor(()=> !!collect(out,3));
  const updLine = collect(out,3);
  expect(updLine, 'no JSON RPC response line for governanceUpdate id=3').toBeTruthy();
  const updObj = JSON.parse(updLine!).result;
    expect(updObj.changed).toBe(true);
    expect(updObj.owner).toBe('team:alpha');
    expect(updObj.version).not.toBe(prevVersion);
    // list again
  send(server,{ jsonrpc:'2.0', id:4, method:'instructions/dispatch', params:{ action:'list' } });
    await waitFor(()=> !!collect(out,4));
    const afterLine = collect(out,4)!; const afterObj = JSON.parse(afterLine).result;
    const afterEntry = (afterObj.items as unknown[]).find((x:unknown)=> (x as { id?:string }).id===id) as { owner:string; status:string; version:string } | undefined;
    expect(afterEntry?.owner).toBe('team:alpha');
    expect(afterEntry?.status).toBe('approved');
    expect(afterEntry?.version).toBe(updObj.version);
    // idempotent second call
    send(server,{ jsonrpc:'2.0', id:5, method:'instructions/governanceUpdate', params:{ id, owner:'team:alpha', status:'approved', bump:'none' } });
    await waitFor(()=> !!collect(out,5));
  const secondLine = collect(out,5);
  expect(secondLine, 'no JSON RPC response line for second governanceUpdate id=5').toBeTruthy();
  const second = JSON.parse(secondLine!).result;
    expect(second.changed).toBe(false);
    server.kill();
  }, 10000);
});
