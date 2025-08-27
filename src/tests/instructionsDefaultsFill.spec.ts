import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('defaults fill only when governance fields omitted', () => {
  it('derives defaults only for missing fields, not overriding provided subset', async () => {
    const id = `defaults_fill_${Date.now()}`;
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'defaults-test', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out,1));
    // Provide only owner & version; omit priorityTier & semanticSummary to allow derivation
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Body defaults', priority:85, audience:'all', requirement:'optional', categories:['defaults'], owner:'defaults-owner', version:'1.2.3' }, overwrite:true, lax:true } } });
  await waitFor(()=> !!findLine(out,2));
    const file = path.join(process.cwd(),'instructions', `${id}.json`);
    const disk = JSON.parse(fs.readFileSync(file,'utf8')) as { owner:string; version:string; priorityTier:string; semanticSummary:string };
    expect(disk.owner).toBe('defaults-owner');
    expect(disk.version).toBe('1.2.3');
    // Derived because priority 85 => P4; semanticSummary auto first line
    expect(disk.priorityTier).toBe('P4');
    expect(typeof disk.semanticSummary).toBe('string');
    expect(disk.semanticSummary.length).toBeGreaterThan(0);
    server.kill();
  }, 15000);
});
