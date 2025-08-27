import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';

// Per-spec isolated instructions directory to avoid cross-test interference
const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-add-'));
function startServer(mutation:boolean){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION: mutation ? '1':'', MCP_LOG_VERBOSE:'', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}

function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

// Helper to call a tool (new unified surface)
function callTool(proc: ReturnType<typeof spawn>, id: number, name: string, args: Record<string, unknown>){
  send(proc,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name, arguments: args }});
}

const wait = (ms:number)=> new Promise(r=>setTimeout(r,ms));

describe('instructions/add tool', () => {
  const instructionsDir = ISOLATED_DIR;
  beforeAll(() => { if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir,{recursive:true}); });

  it('creates a new instruction (lax defaults)', async () => {
    const id = 'add_test_create';
    const file = path.join(instructionsDir, id + '.json');
    if(fs.existsSync(file)) fs.unlinkSync(file);
  await waitForDist();
  const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===1; } catch { return false; } }), 1500);
  callTool(server,2,'instructions/add',{ entry:{ id, body:'Body only' }, lax:true });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }), 2000);
    const line = out.filter(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }).pop();
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
    if(text){
      const inner = JSON.parse(text);
      expect(inner.id).toBe(id);
      if('created' in inner) expect(inner.created).toBe(true);
      if('skipped' in inner) expect(inner.skipped).toBe(false);
      expect(inner.hash).toBeTypeOf('string');
    }
    expect(fs.existsSync(file)).toBe(true);
    server.kill();
  },6000);

  it('skips existing without overwrite', async () => {
    const id = 'add_test_skip';
    const file = path.join(instructionsDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ id, title:id, body:'seed', priority:50, audience:'all', requirement:'optional', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', version:'1.0.0', status:'approved', owner:'unowned', priorityTier:'P3', classification:'internal', lastReviewedAt:new Date().toISOString(), nextReviewDue:new Date().toISOString(), changeLog:[{version:'1.0.0', changedAt:new Date().toISOString(), summary:'initial'}], semanticSummary:'seed' }, null,2));
  await waitForDist();
  const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===10; } catch { return false; } }));
  callTool(server,11,'instructions/add',{ entry:{ id, body:'new body attempt' }, lax:true });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===11; } catch { return false; } }));
    const line = out.filter(l=> { try { const o=JSON.parse(l); return o.id===11; } catch { return false; } }).pop();
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
    if(text){
      const inner = JSON.parse(text);
      expect(inner.id).toBe(id);
      if('skipped' in inner) expect(inner.skipped).toBe(true);
      if('created' in inner) expect(inner.created).toBe(false);
      if('overwritten' in inner) expect(inner.overwritten).toBe(false);
    }
    server.kill();
  },6000);

  it('overwrites when overwrite flag set', async () => {
    const id = 'add_test_overwrite';
    const file = path.join(instructionsDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ id, title:id, body:'old', priority:50, audience:'all', requirement:'optional', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', version:'1.0.0', status:'approved', owner:'unowned', priorityTier:'P3', classification:'internal', lastReviewedAt:new Date().toISOString(), nextReviewDue:new Date().toISOString(), changeLog:[{version:'1.0.0', changedAt:new Date().toISOString(), summary:'initial'}], semanticSummary:'old' }, null,2));
  await waitForDist();
  const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:20, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===20; } catch { return false; } }));
  callTool(server,21,'instructions/add',{ entry:{ id, body:'overwrite body' }, lax:true, overwrite:true });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===21; } catch { return false; } }));
    const line = out.filter(l=> { try { const o=JSON.parse(l); return o.id===21; } catch { return false; } }).pop();
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
    if(text){
      const inner = JSON.parse(text);
      expect(inner.id).toBe(id);
      if('overwritten' in inner) expect(inner.overwritten).toBe(true);
    }
    const disk = JSON.parse(fs.readFileSync(file,'utf8'));
    expect(disk.body).toBe('overwrite body');
    server.kill();
  },6000);

  it('is gated when mutation disabled', async () => {
    const id = 'add_test_gated';
  await waitForDist();
  const server = startServer(false);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:30, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===30; } catch { return false; } }));
  callTool(server,31,'instructions/add',{ entry:{ id, body:'gated attempt'}, lax:true });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===31; } catch { return false; } }));
    const line = out.filter(l=> { try { const o=JSON.parse(l); return o.id===31; } catch { return false; } }).pop();
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
  // Unknown tool now yields -32603 Unknown tool OR mutation gate (-32603). Direct method removed.
  expect(obj.error).toBeTruthy();
  expect(obj.error.code).toBe(-32603);
  expect(String(obj.error.data?.method || obj.error.data?.name || '')).toMatch(/instructions\/add/);
    server.kill();
  },6000);
});
