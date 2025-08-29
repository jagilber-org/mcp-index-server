import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface InstructionItem { id:string; version?:string }
function findLine(lines: string[], id:number): string | undefined { return lines.find(l=> { try { const o=JSON.parse(l); return o && o.id===id; } catch { return false; } }); }
function haveId(lines:string[], id:number){ return !!findLine(lines,id); }

// Stress: attempt concurrent adds of the same ID and ensure no crash + final state consistent.

describe('concurrency: add same id concurrently', () => {
  it('handles rapid duplicate adds deterministically', async () => {
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,140));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'concurrency', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> haveId(out,1));

    const baseId = 'concurrent-' + Date.now();
    const TOTAL = 20;
    for(let i=0;i<TOTAL;i++){
  send(server,{ jsonrpc:'2.0', id:100+i, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:baseId, title:baseId, body:`Body v${i}`, version:'1.0.'+i, owner:'owner-'+i, priority: 10+i, audience:'all', requirement:'optional', categories:['test'] }, overwrite:true, lax:true } } });
    }

    // Wait for the last known add response (allow generous time under coverage)
    const addWaitStart = Date.now();
  while(Date.now()-addWaitStart < 5000 && !haveId(out,100+TOTAL-1)){
      await new Promise(r=> setTimeout(r,120));
    }

    // Attempt to fetch; retry a few times if needed
    let item: InstructionItem | undefined;
    for(let attempt=0; attempt<5 && !item; attempt++){
      send(server,{ jsonrpc:'2.0', id:200+attempt, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id:baseId } } });
      const pollStart = Date.now();
      while(Date.now()-pollStart < 1200 && !haveId(out,200+attempt)){
        await new Promise(r=> setTimeout(r,100));
      }
      const line = findLine(out,200+attempt);
      if(line){
        try {
          const payload = parseToolPayload<{ item?: InstructionItem }>(line);
          if(payload && payload.item) item = payload.item;
        } catch { /* ignore parse */ }
      }
      if(!item) await new Promise(r=> setTimeout(r,150));
    }

    // Fallback: list and locate if direct get did not surface
    if(!item){
      // Fallback: perform several list attempts with small delay to accommodate any late invalidation reload
      for(let attempt=0; attempt<5 && !item; attempt++){
        const listId = 500+attempt;
        send(server,{ jsonrpc:'2.0', id:listId, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
        await waitFor(()=> haveId(out,listId));
        const line = findLine(out,listId);
        const payload = line ? parseToolPayload<{ items: InstructionItem[] }>(line) : undefined;
        const found = payload?.items.find(i=> i.id===baseId);
        if(found){ item = found; break; }
        await new Promise(r=> setTimeout(r,150));
      }
      expect(item, 'Entry should appear in list after concurrent adds').toBeTruthy();
    }

    expect(item, 'Expected to retrieve entry after concurrent adds').toBeTruthy();
    expect(item!.id).toBe(baseId);
    const v = item!.version;
    expect(v && v.startsWith('1.0.'), 'Version should reflect one of the overwrite attempts').toBe(true);

    server.kill();
  }, 25000);
});
