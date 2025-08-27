import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-overwrite-'));
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines: string[], id: number): string | undefined {
  return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } });
}

describe('instructions/add overwrite version semantics (alpha)', () => {
  const instructionsDir = ISOLATED_DIR;
  beforeAll(()=>{ if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir); });

  it('retains existing version & changeLog when body changes without explicit version; updates only when provided', async () => {
    const id = `overwrite_version_${Date.now()}`;
    await waitForDist();
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'coverage', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out,1));

    // Create with explicit governance
  // Add via dispatcher tool
  send(server,{ jsonrpc:'2.0', id:10, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Initial body', priority:55, audience:'all', requirement:'optional', categories:['alpha'], version:'2.5.0', owner:'alpha-owner', priorityTier:'P2', semanticSummary:'Initial summary' }, overwrite:true, lax:true } }});
  await waitFor(()=> !!findLine(out,10));
    const file = path.join(instructionsDir, id + '.json');
    expect(fs.existsSync(file)).toBe(true);
  const first = JSON.parse(fs.readFileSync(file,'utf8')) as { version:string; changeLog: { version:string; changedAt:string; summary:string }[]; owner:string; priorityTier:string; semanticSummary:string };
    expect(first.version).toBe('2.5.0');
    expect(first.owner).toBe('alpha-owner');
    expect(first.priorityTier).toBe('P2');
    expect(first.semanticSummary).toBe('Initial summary');
    const initialChangeLogLen = (first.changeLog||[]).length;

    // Overwrite with new body but no version -> version must stay 2.5.0 and changeLog length unchanged
  send(server,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Modified body once', priority:55, audience:'all', requirement:'optional', categories:['alpha'] }, overwrite:true, lax:true } }});
  await waitFor(()=> !!findLine(out,11));
  const second = JSON.parse(fs.readFileSync(file,'utf8')) as { version:string; changeLog: { version:string; changedAt:string; summary:string }[]; body:string };
    expect(second.body).toBe('Modified body once');
    expect(second.version).toBe('2.5.0');
    expect((second.changeLog||[]).length).toBe(initialChangeLogLen); // no auto bump entry added

    // Overwrite with explicit new version -> version updates, changeLog may be replaced if provided else normalized keeps existing
  send(server,{ jsonrpc:'2.0', id:12, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Modified body twice', priority:55, audience:'all', requirement:'optional', categories:['alpha'], version:'2.6.0' }, overwrite:true, lax:true } }});
  await waitFor(()=> !!findLine(out,12));
  const third = JSON.parse(fs.readFileSync(file,'utf8')) as { version:string; changeLog: { version:string; changedAt:string; summary:string }[]; body:string };
    expect(third.body).toBe('Modified body twice');
    expect(third.version).toBe('2.6.0');

    server.kill();
  }, 15000);
});
