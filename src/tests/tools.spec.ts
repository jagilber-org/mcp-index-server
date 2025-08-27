import { describe, it, expect, beforeAll } from 'vitest';
import { waitFor } from './testUtils';
import { spawn } from 'child_process';
import { waitForDist } from './distReady';
import path from 'path';
import fs from 'fs';

function startServer(){
  const proc = spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio: ['pipe','pipe','pipe'] });
  return proc;
}

type Child = ReturnType<typeof spawn>;
function send(proc: Child, msg: Record<string, unknown>){
  proc.stdin?.write(JSON.stringify(msg) + '\n');
}

describe('instruction tool handlers', () => {
  const instructionsDir = path.join(process.cwd(), 'instructions');
  beforeAll(() => {
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir);
    fs.writeFileSync(path.join(instructionsDir,'alpha.json'), JSON.stringify({
      id:'alpha', title:'Alpha', body:'Alpha body', priority:10, audience:'all', requirement:'mandatory', categories:['a']
    }, null, 2));
    fs.writeFileSync(path.join(instructionsDir,'beta.json'), JSON.stringify({
      id:'beta', title:'Beta', body:'Beta body', priority:40, audience:'all', requirement:'optional', categories:['b']
    }, null, 2));
  });

  it('list and get', async () => {
    const server = startServer();
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));
  await new Promise(r => setTimeout(r, 120));
  // Perform initialize first per MCP spec
  send(server,{ jsonrpc:'2.0', id:99, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await waitForDist();
  await waitFor(() => out.some(l => l.includes('"id":99')));
  send(server,{ jsonrpc:'2.0', id:1, method:'instructions/dispatch', params:{ action:'list' } });
  await waitFor(() => out.some(l => /"id":1/.test(l)));
  const line = out.find(l => /"id":1/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.items.length).toBeGreaterThanOrEqual(2);
    server.kill();
  }, 6000);
});