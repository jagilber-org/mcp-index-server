import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function startServer(mutation = true){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: mutation ? '1' : '' }
  });
}

function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg) + '\n'); }

describe('MCP tool registry', () => {
  it('exposes mcp registry with required fields', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,150));
  send(server, { jsonrpc:'2.0', id: 2000, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,120));
    const id = 42;
    send(server, { jsonrpc:'2.0', id, method: 'meta/tools' });
    await new Promise(r => setTimeout(r,200));
    const line = lines.find(l => l.includes('"id":42'));
    expect(line, 'missing meta/tools response').toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeFalsy();
    const result = obj.result;
    expect(result.mcp, 'missing mcp registry block').toBeTruthy();
    expect(typeof result.mcp.registryVersion).toBe('string');
    expect(Array.isArray(result.mcp.tools)).toBe(true);
  interface RegistryEntry { name:string; description:string; stable:boolean; mutation:boolean; inputSchema:unknown; outputSchema?:unknown }
  const sample = (result.mcp.tools as RegistryEntry[]).find(t => t.name === 'instructions/list');
    expect(sample, 'expected instructions/list registry entry').toBeTruthy();
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
    await new Promise(r => setTimeout(r,150));
  send(server, { jsonrpc:'2.0', id: 2001, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,120));
    const id = 43;
    send(server, { jsonrpc:'2.0', id, method: 'meta/tools' });
    await new Promise(r => setTimeout(r,200));
    const line = lines.find(l => l.includes('"id":43'));
    expect(line, 'missing meta/tools response').toBeTruthy();
    const obj = JSON.parse(line!);
  const disabledList = (obj.result.dynamic.disabled as Array<{ method:string }>).map(d => d.method);
    expect(disabledList).toContain('instructions/import');
    server.kill();
  }, 6000);
});
