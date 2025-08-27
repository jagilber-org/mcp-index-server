import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg) + '\n'); }

describe('instructions/dispatch batch action', () => {
  it('executes mixed batch operations with isolated results', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'batch-test', version: '0' }, capabilities: { tools: {} } } });
    await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===1; } catch { return false; } }), 3000);

    // Seed an instruction via dispatcher add
    send(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'add', entry: { id: 'batch-seed', title: 'Seed', body: 'Seed body', priority: 1, audience: 'all', requirement: 'recommended', categories: ['test'] } } } });
    await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===2; } catch { return false; } }), 3000);

    send(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'batch', ops: [
      { action: 'get', id: 'batch-seed' },
      { action: 'get', id: 'missing-id' },
      { action: 'list' },
      { action: 'nope' },
      { action: 'search', q: 'Seed' }
    ] } } });
    await waitFor(()=> lines.some(l=> { try { return JSON.parse(l).id===3; } catch { return false; } }), 3000);
    server.kill();
    const line = lines.find(l => l.includes('"id":3'));
    expect(line, 'missing batch response').toBeTruthy();
    if(!line) return;
    const obj = JSON.parse(line);
    const batch = obj.result?.content?.[0]?.text ? JSON.parse(obj.result.content[0].text) : obj.result;
    expect(Array.isArray(batch.results)).toBe(true);
    expect(batch.results.length).toBe(5);
    const [r0,r1,r2,r3,r4] = batch.results;
    expect(r0.item?.id).toBe('batch-seed');
    expect(r1.notFound || r1.error).toBeTruthy();
    expect(r2.count).toBeGreaterThan(0);
    expect(r3.error).toBeTruthy();
    expect(r4.count).toBeGreaterThanOrEqual(1);
  }, 8000);
});

// (Removed legacy harness variant)
