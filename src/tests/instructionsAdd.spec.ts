import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

function startServer(mutation:boolean){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION: mutation ? '1':'', MCP_LOG_VERBOSE:'' } });
}

function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

const wait = (ms:number)=> new Promise(r=>setTimeout(r,ms));

describe('instructions/add tool', () => {
  const instructionsDir = path.join(process.cwd(),'instructions');
  beforeAll(() => { if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir); });

  it('creates a new instruction (lax defaults)', async () => {
    const id = 'add_test_create';
    const file = path.join(instructionsDir, id + '.json');
    if(fs.existsSync(file)) fs.unlinkSync(file);
    const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(80);
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/add', params:{ entry:{ id, body:'Body only' }, lax:true } });
    await wait(180);
    const line = out.find(l => /"id":2(?![0-9])/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.id).toBe(id);
    expect(obj.result.created).toBe(true);
    expect(obj.result.skipped).toBe(false);
    expect(obj.result.hash).toBeTypeOf('string');
    expect(fs.existsSync(file)).toBe(true);
    server.kill();
  },6000);

  it('skips existing without overwrite', async () => {
    const id = 'add_test_skip';
    const file = path.join(instructionsDir, id + '.json');
    // seed file
    fs.writeFileSync(file, JSON.stringify({ id, title:id, body:'seed', priority:50, audience:'all', requirement:'optional', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'' }, null,2));
    const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(80);
    send(server,{ jsonrpc:'2.0', id:11, method:'instructions/add', params:{ entry:{ id, body:'new body attempt' }, lax:true } });
    await wait(160);
    const line = out.find(l => /"id":11(?![0-9])/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.id).toBe(id);
    expect(obj.result.skipped).toBe(true);
    expect(obj.result.created).toBe(false);
    expect(obj.result.overwritten).toBe(false);
    server.kill();
  },6000);

  it('overwrites when overwrite flag set', async () => {
    const id = 'add_test_overwrite';
    const file = path.join(instructionsDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ id, title:id, body:'old', priority:50, audience:'all', requirement:'optional', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'' }, null,2));
    const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:20, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(80);
    send(server,{ jsonrpc:'2.0', id:21, method:'instructions/add', params:{ entry:{ id, body:'overwrite body' }, lax:true, overwrite:true } });
    await wait(160);
    const line = out.find(l => /"id":21(?![0-9])/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.id).toBe(id);
    expect(obj.result.overwritten || obj.result.created).toBe(true);
    const disk = JSON.parse(fs.readFileSync(file,'utf8'));
    expect(disk.body).toBe('overwrite body');
    server.kill();
  },6000);

  it('is gated when mutation disabled', async () => {
    const id = 'add_test_gated';
    const server = startServer(false);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:30, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(80);
    send(server,{ jsonrpc:'2.0', id:31, method:'instructions/add', params:{ entry:{ id, body:'gated attempt'}, lax:true } });
    await wait(160);
    const line = out.find(l => /"id":31(?![0-9])/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.error).toBeTruthy();
    expect(obj.error.code).toBe(-32603);
    expect(obj.error.data?.method).toBe('instructions/add');
    server.kill();
  },6000);
});
