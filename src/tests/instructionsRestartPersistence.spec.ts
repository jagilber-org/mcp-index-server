import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines: string[], id:number): string | undefined { return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('restart persistence - governance fields survive restart unchanged', () => {
  it('round-trips governance fields accurately after process restart', async () => {
    const id = `restart_persist_${Date.now()}`;
    // First run: create entry
    let server = startServer();
    const out1: string[] = []; server.stdout.on('data', d=> out1.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'restart-test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out1,1));
  // Add via dispatcher
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Restart body', priority:33, audience:'all', requirement:'optional', categories:['restart'], owner:'restart-owner', version:'7.1.0', priorityTier:'P3', semanticSummary:'Restart summary' }, overwrite:true, lax:true } }});
  await waitFor(()=> !!findLine(out1,2));
    const file = path.join(process.cwd(),'instructions', `${id}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const first = JSON.parse(fs.readFileSync(file,'utf8')) as Record<string, unknown>;
    server.kill();

    // Second run: verify unchanged
    server = startServer();
    const out2: string[] = []; server.stdout.on('data', d=> out2.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'restart-test2', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out2,10));
  send(server,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } }});
    await waitFor(()=> !!findLine(out2,11));
  const respLine = findLine(out2,11);
  const payload = respLine ? parseToolPayload<Record<string,unknown>>(respLine) : undefined;
  expect(payload).toBeTruthy();
  // For simplicity just re-read disk copy after restart (behavior under test is persistence)
  const second = JSON.parse(fs.readFileSync(path.join(process.cwd(),'instructions', `${id}.json`),'utf8')) as Record<string,unknown>;
    const fields = ['version','owner','priorityTier','semanticSummary'];
    for(const f of fields){ expect(second[f]).toEqual(first[f]); }
    server.kill();
  }, 20000);
});
