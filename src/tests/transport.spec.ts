import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
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
    await new Promise(r => setTimeout(r, 150));
  // initialize first
  server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:99, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } }) + '\n');
  await new Promise(r => setTimeout(r, 120));
    server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'health/check' }) + '\n');
    await new Promise(r => setTimeout(r, 150));
    server.kill();
    const responseLine = outputs.find(l => /"id":1/.test(l));
    expect(responseLine).toBeTruthy();
    if(responseLine){
      const obj = JSON.parse(responseLine);
      expect(obj.result.status).toBe('ok');
    }
  }, 5000);
});