import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'] });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

function collect(proc: ReturnType<typeof startServer>, sink: string[]){
  let buf='';
  proc.stdout.on('data', d=>{ buf+=d.toString(); const parts=buf.split(/\n/); buf=parts.pop()!; for(const p of parts){ const line=p.trim(); if(line) sink.push(line); } });
}

async function waitForId(lines: string[], id: number, timeout=4000){
  await waitFor(()=> lines.some(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } }), timeout);
  return lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } });
}

// Keep in sync with toolRegistry.STABLE set
const STABLE_TOOLS = [
  'health/check','instructions/dispatch','instructions/governanceHash','instructions/query','instructions/categories','prompt/review','integrity/verify','usage/track','usage/hotset','metrics/snapshot','gates/evaluate','meta/tools'
];

describe('stable tools coverage smoke', () => {
  it('invokes each stable tool at least once (ensures no hang & basic success)', async () => {
    const server = startServer();
    const lines: string[] = [];
    collect(server, lines);
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'cov', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitForId(lines,1);

    let nextId=2;
    for(const tool of STABLE_TOOLS){
      const args: Record<string,unknown> = {};
      if(tool==='instructions/dispatch') args.action='list';
      if(tool==='usage/track') args.id='coverage-probe';
      if(tool==='prompt/review') args.prompt='dummy prompt';
      // Invoke every tool via tools/call unified surface
      send(server,{ jsonrpc:'2.0', id: nextId, method: 'tools/call', params:{ name: tool, arguments: args } });
      nextId++;
    }
    // Wait for all ids
    const lastId = nextId-1;
    await waitFor(()=> {
      return lines.filter(l=>{ try { const o=JSON.parse(l); return o.id>=2 && o.id<=lastId; } catch { return false; } }).length === STABLE_TOOLS.length;
    }, 6000);

    // Basic assertions: each tool responded without error
    for(let id=2; id<=lastId; id++){
  const line = lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } });
      expect(line, `missing response for id ${id}`).toBeTruthy();
      if(line){
        const obj = JSON.parse(line);
        if(obj.error){
          throw new Error(`Tool id ${id} failed: ${obj.error.message}`);
        }
      }
    }
    server.kill();
  }, 15000);
});
