import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: '1' }
  });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg) + '\n'); }

describe('input validation', () => {
  it('rejects missing required param', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,120));
  send(server, { jsonrpc:'2.0', id: 3000, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,100));
    const id = 101;
    // instructions/get requires id
    send(server, { jsonrpc:'2.0', id, method: 'instructions/get', params: {} });
    await new Promise(r => setTimeout(r,180));
    const line = lines.find(l => l.includes('"id":101'));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeTruthy();
    expect(obj.error.code).toBe(-32602);
    server.kill();
  }, 6000);

  it('rejects additional properties when disallowed', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,120));
  send(server, { jsonrpc:'2.0', id: 3001, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,100));
    const id = 102;
    send(server, { jsonrpc:'2.0', id, method: 'instructions/list', params: { category: 'general', extra: 'x' } });
    await new Promise(r => setTimeout(r,180));
    const line = lines.find(l => l.includes('"id":102'));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeTruthy();
    expect(obj.error.code).toBe(-32602);
    server.kill();
  }, 6000);

  it('accepts valid params', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,120));
  send(server, { jsonrpc:'2.0', id: 3002, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,100));
    const id = 103;
    send(server, { jsonrpc:'2.0', id, method: 'instructions/list', params: { category: 'general' } });
    await new Promise(r => setTimeout(r,180));
    const line = lines.find(l => l.includes('"id":103'));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeFalsy();
    expect(obj.result).toBeTruthy();
    server.kill();
  }, 6000);
});
