import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';

// Isolated directory per spec file
const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-attrib-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

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
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===0; } catch { return false; } }), 2000);
    const id = 'attrib-' + Date.now();
    send(server,{ jsonrpc:'2.0', id:1, method:'instructions/add', params:{ entry:{ id, body:'Body attrib', title:id }, overwrite:true, lax:true } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===1; } catch { return false; } }), 2000);
  send(server,{ jsonrpc:'2.0', id:2, method:'instructions/dispatch', params:{ action:'get', id } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }), 2000);
    const line = out.filter(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }).pop();
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.item.createdByAgent).toBe('agent-test');
    expect(obj.result.item.sourceWorkspace).toBe('workspace-xyz');
    server.kill();
  },6000);

  it('scoped list falls back to audience all when no explicit scope match', async () => {
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    send(server,{ jsonrpc:'2.0', id:0, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===0; } catch { return false; } }), 2000);
    const id = 'attrib-scope-' + Date.now();
    send(server,{ jsonrpc:'2.0', id:1, method:'instructions/add', params:{ entry:{ id, body:'Scoped Body', title:id }, overwrite:true, lax:true } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===1; } catch { return false; } }), 2000);
  send(server,{ jsonrpc:'2.0', id:2, method:'instructions/dispatch', params:{ action:'listScoped', workspaceId:'non-matching-workspace' } });
    await waitFor(()=> out.some(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }), 2000);
    const line = out.filter(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }).pop();
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.scope).toBe('all');
    server.kill();
  },6000);
});
