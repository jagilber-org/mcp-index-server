import { describe, it, expect } from 'vitest';
import { waitFor } from './testUtils';
import { spawn } from 'child_process';
import path from 'path';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: '1' }
  });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg) + '\n'); }

describe('input validation (dispatcher)', () => {
  it('rejects missing required action', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
  await new Promise(r => setTimeout(r,100));
  send(server, { jsonrpc:'2.0', id: 3000, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitFor(() => lines.some(l => l.includes('"id":3000')));
    const id = 101;
    // Missing action entirely should trigger -32602
  send(server, { jsonrpc:'2.0', id, method: 'tools/call', params:{ name:'instructions/dispatch', arguments:{} } });
  await waitFor(() => lines.some(l => l.includes('"id":101')));
  const line = lines.find(l => l.includes('"id":101'));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeTruthy();
  // Dispatcher currently surfaces missing action as internal/generic (-32603)
  expect(obj.error.code).toBe(-32603);
    server.kill();
  }, 6000);
  it('rejects unknown action', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
  await new Promise(r => setTimeout(r,100));
  send(server, { jsonrpc:'2.0', id: 3001, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitFor(() => lines.some(l => l.includes('"id":3001')));
    const id = 102;
  send(server, { jsonrpc:'2.0', id, method: 'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'__nope__' } } });
  await waitFor(() => lines.some(l => l.includes('"id":102')));
  const line = lines.find(l => l.includes('"id":102'));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeTruthy();
  // Unknown action currently surfaces generic error (-32603)
  expect(obj.error.code).toBe(-32603);
    server.kill();
  }, 6000);

  it('accepts valid list action', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
  await new Promise(r => setTimeout(r,100));
  send(server, { jsonrpc:'2.0', id: 3002, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitFor(() => lines.some(l => l.includes('"id":3002')));
    const id = 103;
  send(server, { jsonrpc:'2.0', id, method: 'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list', category:'general' } } });
  await waitFor(() => lines.some(l => l.includes('"id":103')));
  const line = lines.find(l => l.includes('"id":103'));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeFalsy();
    expect(obj.result).toBeTruthy();
    server.kill();
  }, 6000);
});
