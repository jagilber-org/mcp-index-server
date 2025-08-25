import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

function startServer(mutation:boolean){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION: mutation ? '1':'', MCP_LOG_VERBOSE:'' } });
}
function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
const wait = (ms:number)=> new Promise(r=>setTimeout(r,ms));

const instructionsDir = path.join(process.cwd(),'instructions');

describe('instructions/groom tool', () => {
  beforeAll(()=>{ if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir); });

  it('dryRun reports without modifying files', async () => {
    const id = 'groom_dryrun_sample';
    const file = path.join(instructionsDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ id, title:id, body:'body', priority:50, audience:'all', requirement:'optional', categories:['Tag','tag'], sourceHash:'WRONG', schemaVersion:'1', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },null,2));
    const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/groom', params:{ mode:{ dryRun:true, mergeDuplicates:true, removeDeprecated:true } } });
    await wait(160);
    const line = out.find(l => /"id":2(?![0-9])/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.dryRun).toBe(true);
    expect(obj.result.scanned).toBeGreaterThan(0);
    // Hash will not change in dryRun
    expect(obj.result.previousHash).toBe(obj.result.hash);
    server.kill();
    // File should remain with wrong hash
    const disk = JSON.parse(fs.readFileSync(file,'utf8'));
    expect(disk.sourceHash).toBe('WRONG');
  }, 6000);

  it('repairs hash and normalizes categories when executed', async () => {
    const id = 'groom_repair_sample';
    const file = path.join(instructionsDir, id + '.json');
  fs.writeFileSync(file, JSON.stringify({ id, title:id, body:'repair body', priority:40, audience:'all', requirement:'optional', categories:['A','a'], sourceHash:'', schemaVersion:'1', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },null,2));
    const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:11, method:'instructions/groom', params:{ mode:{ mergeDuplicates:false, removeDeprecated:false } } });
    await wait(160);
    const line = out.find(l => /"id":11(?![0-9])/.test(l));
    expect(line).toBeTruthy();
  const obj = JSON.parse(line!);
  expect(obj.result.dryRun).toBe(false);
  expect(obj.result.repairedHashes).toBeGreaterThan(0);
  expect(obj.result.normalizedCategories).toBeGreaterThanOrEqual(0);
    server.kill();
    const disk = JSON.parse(fs.readFileSync(file,'utf8'));
  expect(typeof disk.sourceHash).toBe('string');
  expect(disk.sourceHash.length).toBeGreaterThan(0);
    expect(disk.categories).toEqual(['a']);
  }, 6000);

  it('merges duplicates and removes deprecated when configured', async () => {
    const body = 'dup body unify';
    const a = path.join(instructionsDir, 'groom_dup_a.json');
    const b = path.join(instructionsDir, 'groom_dup_b.json');
    fs.writeFileSync(a, JSON.stringify({ id:'groom_dup_a', title:'A', body, priority:60, audience:'all', requirement:'optional', categories:['x'], sourceHash:'', schemaVersion:'1', createdAt:'2025-01-01T00:00:00.000Z', updatedAt:'2025-01-01T00:00:00.000Z' },null,2));
    fs.writeFileSync(b, JSON.stringify({ id:'groom_dup_b', title:'B', body, priority:70, audience:'all', requirement:'optional', categories:['y'], sourceHash:'', schemaVersion:'1', createdAt:'2025-02-01T00:00:00.000Z', updatedAt:'2025-02-01T00:00:00.000Z' },null,2));
    const server = startServer(true);
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
    await wait(120);
    send(server,{ jsonrpc:'2.0', id:20, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test', version:'0' }, capabilities:{ tools:{} } } });
    await wait(60);
    send(server,{ jsonrpc:'2.0', id:21, method:'instructions/groom', params:{ mode:{ mergeDuplicates:true, removeDeprecated:true } } });
    await wait(200);
    const line = out.find(l => /"id":21(?![0-9])/.test(l));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.result.deprecatedRemoved + obj.result.duplicatesMerged).toBeGreaterThan(0);
    server.kill();
    // One file should remain
    const existsA = fs.existsSync(a);
    const existsB = fs.existsSync(b);
    expect(existsA || existsB).toBe(true);
    expect(!(existsA && existsB)).toBe(true);
  }, 8000);
});
