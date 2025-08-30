import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForServerReady, ensureFileExists, ensureDir, ensureJsonReadable, getResponse, waitForCatalogEntry } from './testUtils';
import { waitForDist } from './distReady';

// Minimal record view for governance field assertions
type EntryRecord = { [k: string]: unknown; id?: string };

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
    // Use catalog loader polling (directory scan) rather than JSON-RPC round trips to eliminate
    // race where add call returns before async persistence completes. Give generous 25s window.
  let before: EntryRecord | undefined;
    try {
  const catalog = await waitForCatalogEntry(instrDir, id, 35000, 150);
  before = catalog.entry as unknown as EntryRecord;
    } catch (e){
      // Fallback: direct file probes (extended timeout) for diagnostic context
      try {
        await ensureFileExists(file, 25000); 
  before = await ensureJsonReadable<Record<string, unknown>>(file, 25000) as unknown as EntryRecord;
      } catch(inner){
        const tail = out.slice(-30).join('\n');
        throw new Error(`Timeout establishing pre-enrich state for ${id} err=${(e as Error).message} fallbackErr=${(inner as Error).message} tail=\n${tail}`);
      }
    }
    // Enrich invocation
    send(server, { jsonrpc:'2.0', id:ENRICH_ID, method:'tools/call', params:{ name:'instructions/enrich', arguments:{} } });
  const enrichEnv = await getResponse(out, ENRICH_ID, 25000);
    if(enrichEnv.error){
      const tail = out.slice(-15).join('\n');
      throw new Error(`Enrich call returned error: ${JSON.stringify(enrichEnv.error)} tail=\n${tail}`);
    }
    // File may be rewritten; wait until JSON readable again
    // Prefer querying again; fallback to file.
    // Re-acquire entry after enrich via catalog scan (deterministic view)
  let after: EntryRecord | undefined;
    try {
  const catalog = await waitForCatalogEntry(instrDir, id, 35000, 150);
  after = catalog.entry as unknown as EntryRecord;
    } catch (e){
      try {
        await ensureFileExists(file, 25000); 
  after = await ensureJsonReadable<Record<string, unknown>>(file, 25000) as unknown as EntryRecord;
      } catch(inner){
        const tail = out.slice(-30).join('\n');
        throw new Error(`Timeout establishing post-enrich state for ${id} err=${(e as Error).message} fallbackErr=${(inner as Error).message} tail=\n${tail}`);
      }
    }
    if(!before || !after){
      throw new Error('Missing before/after entries for governance assertion');
    }
    for (const f of ['owner','version','priorityTier','semanticSummary']) { expect(after[f]).toEqual(before[f]); }
    server.kill();
  }, 70000);
});
