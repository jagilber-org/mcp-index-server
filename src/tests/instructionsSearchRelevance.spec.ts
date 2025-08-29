import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(p: ReturnType<typeof startServer>, msg: Record<string, unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines: string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

// Simple relevance smoke test: ensuring that domain keywords present in the markdown-rich fixture
// surface the entry through search. (The underlying search implementation may evolve; this test
// guards regression by asserting at least one hit for each critical keyword.)

const KEYWORDS = ['Service Fabric', 'Well-Architected', 'Semantic Kernel', 'PowerShell'];

describe('search relevance over rich markdown', () => {
  it('returns the large instruction for representative domain keywords', async () => {
    const server = startServer();
    const lines: string[] = []; server.stdout.on('data', d=> lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,140));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'search-rich', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findLine(lines,1));

    const id = 'enterprise-search-' + Date.now();
    const body = KEYWORDS.map(k=> `# ${k} Resources\n- Link about ${k} https://example.com/${k.replace(/\s+/g,'-').toLowerCase()}` ).join('\n\n') + '\n\nGeneral notes about Azure Well-Architected and Service Fabric synergy.';
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Search Fixture', body, priority:30, audience:'all', requirement:'optional', categories:['search','development-tools'] }, overwrite:true, lax:true } } });
    await waitFor(()=> !!findLine(lines,2));

    for(const [idx, term] of KEYWORDS.entries()){
      const rpcId = 10 + idx;
      send(server,{ jsonrpc:'2.0', id:rpcId, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'search', q: term } } });
      await waitFor(()=> !!findLine(lines,rpcId));
      const payload = parseToolPayload<{ items:{ id:string }[] }>(findLine(lines,rpcId)!);
      expect(payload?.items.some(i=> i.id===id), `Expected search hit for term '${term}'`).toBe(true);
    }

    server.kill();
  }, 20000);
});
