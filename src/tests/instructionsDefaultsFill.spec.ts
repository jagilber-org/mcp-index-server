import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor, ensureFileExists, ensureJsonReadable, waitForServerReady, ensureDir } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('defaults fill only when governance fields omitted', () => {
  it('derives defaults only for missing fields, not overriding provided subset', async () => {
    // High-id scheme to avoid ordering assumptions & first-run race
    const INIT_ID = 6100;
    const META_ID = 6101;
    const LIST_PROBE_ID = 6102;
    const ADD_ID = 6103;
    ensureDir(path.join(process.cwd(),'instructions'));
    const entryId = `defaults_fill_${Date.now()}`;
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    // Deterministic readiness (initialize + meta/tools + list probe)
    await waitForServerReady(server, out, { initId: INIT_ID, metaId: META_ID, probeList: true, listId: LIST_PROBE_ID });
    // Provide only owner & version; omit priorityTier & semanticSummary to allow derivation
    send(server,{ jsonrpc:'2.0', id:ADD_ID, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id: entryId, title: entryId, body:'Body defaults', priority:85, audience:'all', requirement:'optional', categories:['defaults'], owner:'defaults-owner', version:'1.2.3' }, overwrite:true, lax:true } } });
    await waitFor(()=> !!findLine(out,ADD_ID));
    const file = path.join(process.cwd(),'instructions', `${entryId}.json`);
  await ensureFileExists(file, 10000);
  await ensureJsonReadable(file, 10000);
    const disk = JSON.parse(fs.readFileSync(file,'utf8')) as { owner:string; version:string; priorityTier:string; semanticSummary:string };
    expect(disk.owner).toBe('defaults-owner');
    expect(disk.version).toBe('1.2.3');
    // Derived because priority 85 => P4; semanticSummary auto first line
    expect(disk.priorityTier).toBe('P4');
    expect(typeof disk.semanticSummary).toBe('string');
    expect(disk.semanticSummary.length).toBeGreaterThan(0);
    server.kill();
  }, 15000);
});
