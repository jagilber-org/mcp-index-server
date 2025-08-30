import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload } from './testUtils';

// Isolated directory per spec file
const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-attrib-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function haveId(lines:string[], id:number){ return lines.some(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }); }
function findLine(lines:string[], id:number){ return lines.filter(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }).pop(); }

describe('instructions attribution', () => {
  beforeAll(() => {
    process.env.MCP_ENABLE_MUTATION = '1';
    process.env.MCP_AGENT_ID = 'agent-test';
    process.env.WORKSPACE_ID = 'workspace-xyz';
  });

  it('captures createdByAgent and sourceWorkspace on new add', async () => {
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    // initialize
  send(server,{ jsonrpc:'2.0', id:0, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out,0), 2000);
    const id = 'attrib-' + Date.now();
  send(server,{ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, body:'Body attrib', title:id }, overwrite:true, lax:true } } });
  await waitFor(()=> haveId(out,1), 2000);
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } } });
  await waitFor(()=> haveId(out,2), 2000);
  const line = findLine(out,2);
  expect(line).toBeTruthy();
  const payload = parseToolPayload<{ item?:{ createdByAgent:string; sourceWorkspace:string } }>(line!);
  expect(payload && payload.item && payload.item.createdByAgent).toBe('agent-test');
  expect(payload && payload.item && payload.item.sourceWorkspace).toBe('workspace-xyz');
    server.kill();
  },6000);

  it('scoped list falls back to audience all when no explicit scope match', async () => {
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
  send(server,{ jsonrpc:'2.0', id:0, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out,0), 2000);
    const id = 'attrib-scope-' + Date.now();
  send(server,{ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, body:'Scoped Body', title:id }, overwrite:true, lax:true } } });
  await waitFor(()=> haveId(out,1), 2000);
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'listScoped', workspaceId:'non-matching-workspace' } } });
  await waitFor(()=> haveId(out,2), 2000);
  const line = findLine(out,2);
  expect(line).toBeTruthy();
  const payload2 = parseToolPayload<{ scope?:string }>(line!);
  expect(payload2 && payload2.scope).toBe('all');
    server.kill();
  },6000);
});
