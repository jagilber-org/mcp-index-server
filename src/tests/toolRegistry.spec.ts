import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(mutation = true){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: mutation ? '1' : '' }
  });
}

function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg) + '\n'); }

function callTool(proc: ReturnType<typeof spawn>, id: number, name: string, args: Record<string, unknown> = {}){
  send(proc,{ jsonrpc:'2.0', id, method:'tools/call', params:{ name, arguments: args } });
}

describe('MCP tool registry', () => {
  it('exposes mcp registry with required fields', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
  send(server, { jsonrpc:'2.0', id: 2000, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===2000; } catch { return false; } }), 3000);
  const id = 42;
  callTool(server, id, 'meta/tools', {});
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }), 3000);
    const line = lines.find(l => l.includes('"id":42'));
    expect(line, 'missing meta/tools response').toBeTruthy();
  const obj = JSON.parse(line!);
  expect(obj.error).toBeFalsy();
  const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
  if(!text){ server.kill(); return; }
  const result = JSON.parse(text);
    expect(result.mcp, 'missing mcp registry block').toBeTruthy();
    expect(typeof result.mcp.registryVersion).toBe('string');
    expect(Array.isArray(result.mcp.tools)).toBe(true);
  interface RegistryEntry { name:string; description:string; stable:boolean; mutation:boolean; inputSchema:unknown; outputSchema?:unknown }
  const sample = (result.mcp.tools as RegistryEntry[]).find(t => t.name === 'instructions/dispatch');
    expect(sample, 'expected instructions/dispatch registry entry').toBeTruthy();
  expect(sample).toBeTruthy();
  if(!sample) return; // type guard for TS
  expect(sample.description && typeof sample.description === 'string').toBeTruthy();
  expect(sample.inputSchema && typeof sample.inputSchema === 'object').toBeTruthy();
    server.kill();
  }, 6000);

  it('marks mutation tools correctly when disabled', async () => {
    const server = startServer(false);
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
  send(server, { jsonrpc:'2.0', id: 2001, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===2001; } catch { return false; } }), 3000);
  const id = 43;
  callTool(server, id, 'meta/tools', {});
  await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }), 3000);
    const line = lines.find(l => l.includes('"id":43'));
    expect(line, 'missing meta/tools response').toBeTruthy();
    const obj = JSON.parse(line!);
    const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
    if(text){
      const result = JSON.parse(text);
      const disabledList = (result.dynamic?.disabled as Array<{ method:string }> | undefined)?.map(d=> d.method) || [];
      expect(disabledList).toContain('instructions/import');
    }
    server.kill();
  }, 6000);
});
