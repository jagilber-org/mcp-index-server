import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'] });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg) + '\n'); }

describe('instructions/dispatch capabilities action', () => {
  it('returns version, supportedActions, mutationEnabled', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'capabilities-test', version: '0' }, capabilities: { tools: {} } } });
    await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===1; } catch { return false; } }), 3000);

    send(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'capabilities' } } });
    await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }), 3000);
    server.kill();
    const line = lines.find(l => l.includes('"id":2'));
    expect(line, 'missing capabilities response').toBeTruthy();
    if(!line) return;
    const obj = JSON.parse(line);
    const cap = obj.result?.content?.[0]?.text ? JSON.parse(obj.result.content[0].text) : obj.result;
    expect(typeof cap.version).toBe('string');
    expect(Array.isArray(cap.supportedActions)).toBe(true);
    expect(cap.supportedActions).toContain('list');
    expect(cap.supportedActions).toContain('batch');
    expect(typeof cap.mutationEnabled).toBe('boolean');
  }, 6000);
});

// (Removed legacy harness variant)
