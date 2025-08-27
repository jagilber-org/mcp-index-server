import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor, findResponse } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg) + '\n'); }


describe('instructions/dispatch batch action', () => {
  it('executes mixed batch operations with isolated results', async () => {
    const server = startServer();
    const lines: string[] = [];
    // Buffered line assembly to avoid splitting JSON messages across chunk boundaries (reduces flakiness)
    let buf = '';
    server.stdout.on('data', d => {
      buf += d.toString();
      const parts = buf.split(/\n/);
      buf = parts.pop() || '';
      for(const raw of parts){
        const line = raw.trim();
        if(line) lines.push(line);
      }
    });

    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'batch-test', version: '0' }, capabilities: { tools: {} } } });
    await waitFor(()=> !!findResponse(lines,1), 4000);

    // Seed an instruction via dispatcher add
    send(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'add', entry: { id: 'batch-seed', title: 'Seed', body: 'Seed body', priority: 1, audience: 'all', requirement: 'recommended', categories: ['test'] } } } });
    await waitFor(()=> !!findResponse(lines,2), 4000);

    // Batch mixed ops
    send(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'batch', ops: [
      { action: 'get', id: 'batch-seed' },
      { action: 'get', id: 'missing-id' },
      { action: 'list' },
      { action: 'nope' },
      { action: 'search', q: 'Seed' }
    ] } } });
  await waitFor(()=> !!findResponse(lines,3), 8000);

    const obj = findResponse(lines,3);
    // Extra guard: allow a brief flush window if we saw id but not result yet
    if(!obj){
      await new Promise(r=> setTimeout(r,75));
    }
    const final = obj ?? findResponse(lines,3);
    expect(final, 'missing batch response').toBeTruthy();
  if(!final){ server.kill(); return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test decoding of dynamic envelope
  const r: any = final.result as any; // permissive for test decoding
  const batch = r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : r;
    expect(Array.isArray(batch.results)).toBe(true);
    expect(batch.results.length).toBe(5);
    const [r0,r1,r2,r3,r4] = batch.results;
    expect(r0.item?.id).toBe('batch-seed');
    expect(r1.notFound || r1.error).toBeTruthy();
    expect(r2.count).toBeGreaterThan(0);
    expect(r3.error).toBeTruthy();
    expect(r4.count).toBeGreaterThanOrEqual(1);
    server.kill();
  }, 10000);
});

// (Removed legacy harness variant)
