import { describe, it, expect } from 'vitest';
import { waitFor } from './testUtils';
import { spawn } from 'child_process';
import { waitForDist } from './distReady';
import path from 'path';

function startServer(){
  const proc = spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio: ['pipe','pipe','pipe'] });
  return proc;
}

describe('transport health handler', () => {
  it('responds to health/check', async () => {
    const server = startServer();
    const outputs: string[] = [];
    server.stdout.on('data', d => outputs.push(...d.toString().trim().split(/\n+/)));
  await new Promise(r => setTimeout(r, 120));
  // initialize first
  server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:99, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } }) + '\n');
  await waitForDist();
  await waitFor(() => outputs.some(l => l.includes('"id":99')));
  server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'health/check', arguments:{} } }) + '\n');
  await waitFor(() => outputs.some(l => /"id":1/.test(l)));
    server.kill();
  const responseLine = outputs.find(l => /"id":1/.test(l));
    expect(responseLine).toBeTruthy();
    if(responseLine){
      const obj = JSON.parse(responseLine);
  const text = obj.result?.content?.[0]?.text;
  expect(text).toBeTruthy();
  if(text){ const parsed = JSON.parse(text); expect(parsed.status).toBe('ok'); }
    }
  }, 5000);
});