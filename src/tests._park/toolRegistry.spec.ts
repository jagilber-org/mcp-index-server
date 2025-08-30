import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForServerReady } from './testUtils';

function startServer(mutation = true){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: mutation ? '1' : '' }
  });
}

// (send helper not required; no direct manual JSON-RPC sends in this spec)

// callTool helper not needed here; waitForServerReady performs meta/tools call

describe('MCP tool registry', () => {
  it('exposes mcp registry with required fields', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    const ready = await waitForServerReady(server, lines, { initId:2000, metaId:42, timeoutMs:5000 });
    expect(ready, 'missing meta/tools response').toBeTruthy();
    const obj = ready! as { error?: unknown; result?: { content?: { text?: string }[] } };
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
  const ready = await waitForServerReady(server, lines, { initId:2001, metaId:43, timeoutMs:5000 });
  expect(ready, 'missing meta/tools response').toBeTruthy();
  const obj = ready! as { result?: { content?: { text?: string }[] } };
  const text = obj.result?.content?.[0]?.text; expect(text).toBeTruthy();
    if(text){
      const result = JSON.parse(text);
      const disabledList = (result.dynamic?.disabled as Array<{ method:string }> | undefined)?.map(d=> d.method) || [];
      expect(disabledList).toContain('instructions/import');
    }
    server.kill();
  }, 6000);
});
