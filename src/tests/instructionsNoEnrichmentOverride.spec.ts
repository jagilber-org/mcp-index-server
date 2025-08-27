import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForServerReady, ensureFileExists, ensureDir, ensureJsonReadable, getResponse } from './testUtils';
import { waitForDist } from './distReady';

// Typed envelopes to avoid explicit any casts in assertions
interface InstructionEntryRecord extends Record<string, unknown> { id: string }
function hasEntry(env: unknown, id: string): env is { result: { entry: InstructionEntryRecord } } {
  if (typeof env !== 'object' || env === null) return false;
  const r = (env as { result?: unknown }).result;
  if (typeof r !== 'object' || r === null) return false;
  const e = (r as { entry?: unknown }).entry;
  if (typeof e !== 'object' || e === null) return false;
  return 'id' in e && (e as { id: unknown }).id === id;
}

async function ensureDist(){ await waitForDist(); }
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

describe('enrich/groom do not override explicit governance', () => {
  it('explicit governance fields remain unchanged after enrich invocation', async () => {
    const id = `no_enrich_override_${Date.now()}`;
    await ensureDist();
    const server = startServer();
    // Robust line buffering (avoid splitting JSON across chunks)
    const out: string[] = [];
    let buffer = '';
    server.stdout.on('data', d => {
      buffer += d.toString();
      const parts = buffer.split(/\n/);
      buffer = parts.pop() || '';
      for (const p of parts) { const line = p.trim(); if(line) out.push(line); }
    });
    // Deterministic readiness handshake (high IDs)
    const INIT_ID = 6300, META_ID = 6301, LIST_ID = 6302, ADD_ID = 6303, ENRICH_ID = 6304;
    await waitForServerReady(server, out, { initId: INIT_ID, metaId: META_ID, probeList: true, listId: LIST_ID });
    // Add instruction with explicit governance fields we expect NOT to be overridden
    send(server, { jsonrpc:'2.0', id:ADD_ID, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Enrich body', priority:10, audience:'all', requirement:'optional', categories:['enrich'], owner:'enrich-owner', version:'5.4.3', priorityTier:'P1', semanticSummary:'Custom enrich summary' }, overwrite:true, lax:true } } });
    const addEnv = await getResponse(out, ADD_ID, 10000);
    if(addEnv.error){
      const tail = out.slice(-15).join('\n');
      throw new Error(`Add dispatch returned error: ${JSON.stringify(addEnv.error)} tail=\n${tail}`);
    }
    // Ensure file persisted & fully readable (allow longer under load / Windows IO lag). If it does not
    // appear quickly, proactively probe the server with a query to force a catalog load cycle which in turn
    // stabilizes visibility of freshly written files on slower filesystems.
    const instrDir = path.join(process.cwd(),'instructions');
    ensureDir(instrDir);
    const file = path.join(instrDir, `${id}.json`);
    // Poll through query first (canonical catalog view) which also forces internal reload; fallback to
    // direct file existence if query path does not surface the entry quickly.
    const QUERY_ID = ENRICH_ID + 100; // distinct sequence block
    let before: Record<string, unknown> | undefined;
    const queryStart = Date.now();
    while(!before && Date.now() - queryStart < 12000){
      send(server, { jsonrpc:'2.0', id:QUERY_ID, method:'tools/call', params:{ name:'instructions/query', arguments:{ id } } });
      const env: unknown = await getResponse(out, QUERY_ID, 2000).catch(()=>null);
      if(hasEntry(env, id)){
        before = env.result.entry;
        break;
      }
      await new Promise(r=> setTimeout(r, 200));
    }
    if(!before){
      try { await ensureFileExists(file, 12000); before = await ensureJsonReadable<Record<string, unknown>>(file, 12000); }
      catch(e){
        const tail = out.slice(-25).join('\n');
        throw new Error(`Timeout establishing pre-enrich state for ${id} tail=\n${tail} err=${(e as Error).message}`);
      }
    }
    // Enrich invocation
    send(server, { jsonrpc:'2.0', id:ENRICH_ID, method:'tools/call', params:{ name:'instructions/enrich', arguments:{} } });
    const enrichEnv = await getResponse(out, ENRICH_ID, 12000);
    if(enrichEnv.error){
      const tail = out.slice(-15).join('\n');
      throw new Error(`Enrich call returned error: ${JSON.stringify(enrichEnv.error)} tail=\n${tail}`);
    }
    // File may be rewritten; wait until JSON readable again
    // Prefer querying again; fallback to file.
    let after: Record<string, unknown> | undefined;
    const afterStart = Date.now();
    while(!after && Date.now() - afterStart < 12000){
      send(server, { jsonrpc:'2.0', id:QUERY_ID+1, method:'tools/call', params:{ name:'instructions/query', arguments:{ id } } });
      const env: unknown = await getResponse(out, QUERY_ID+1, 2000).catch(()=>null);
      if(hasEntry(env, id)){
        after = env.result.entry;
        break;
      }
      await new Promise(r=> setTimeout(r, 200));
    }
    if(!after){
      try { await ensureFileExists(file, 12000); after = await ensureJsonReadable<Record<string, unknown>>(file, 12000); }
      catch(e){
        const tail = out.slice(-25).join('\n');
        throw new Error(`Timeout establishing post-enrich state for ${id} tail=\n${tail} err=${(e as Error).message}`);
      }
    }
    for (const f of ['owner','version','priorityTier','semanticSummary']) { expect(after[f]).toEqual(before[f]); }
    server.kill();
  }, 30000);
});
