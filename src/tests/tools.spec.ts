import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
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
      id:'alpha', title:'Alpha Instruction', body:'Do Alpha things', priority:10,
      audience:'all', requirement:'mandatory', categories:['general'], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    }, null, 2));
    fs.writeFileSync(path.join(instructionsDir,'beta.json'), JSON.stringify({
      id:'beta', title:'Beta Guide', body:'Beta body text', priority:30,
      audience:'group', requirement:'recommended', categories:['general','beta'], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    }, null, 2));
  });

  it('list and get', async () => {
    const server = startServer();
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r, 150));
    send(server,{ jsonrpc:'2.0', id:1, method:'instructions/list', params:{} });
    await new Promise(r => setTimeout(r, 150));
    const line = out.find(l => /"id":1/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.items.length).toBeGreaterThanOrEqual(2);
    server.kill();
  }, 6000);
});