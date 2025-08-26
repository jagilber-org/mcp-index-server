import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
interface RpcSuccess<T=unknown> { id:number; result:T }
interface RpcError { id:number; error:unknown }
type RpcResponse<T=unknown> = RpcSuccess<T> | RpcError | undefined;
function findResponse(lines: string[], id:number): RpcResponse | undefined { for(const l of lines){ try { const o=JSON.parse(l) as RpcResponse; if(o && o.id===id) return o; } catch { /*ignore*/ } } return undefined; }

// Helper: robust JSON file read with retries to avoid transient ENOENT during async rewrite cycles
async function readJsonWithRetry<T=unknown>(file: string, timeoutMs=5000, intervalMs=75): Promise<T> {
  const start = Date.now();
  while(Date.now()-start < timeoutMs){
    try {
      if(fs.existsSync(file)){
        const txt = fs.readFileSync(file,'utf8');
        return JSON.parse(txt) as T;
      }
  } catch { /* retry */ }
    await new Promise(r=> setTimeout(r, intervalMs));
  }
  // Final attempt
  const txt = fs.readFileSync(file,'utf8');
  return JSON.parse(txt) as T; // will throw if still failing
}

describe('enrich/groom do not override explicit governance', () => {
  it('explicit governance fields remain unchanged after enrich invocation', async () => {
    const id = `no_enrich_override_${Date.now()}`;
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'enrich-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));
    send(server,{ jsonrpc:'2.0', id:2, method:'instructions/add', params:{ entry:{ id, title:id, body:'Enrich body', priority:10, audience:'all', requirement:'optional', categories:['enrich'], owner:'enrich-owner', version:'5.4.3', priorityTier:'P1', semanticSummary:'Custom enrich summary' }, overwrite:true, lax:true } });
    await waitFor(()=> !!findResponse(out,2));
  const file = path.join(process.cwd(),'instructions', `${id}.json`);
  // Poll (waitFor) for file creation to avoid ENOENT race (spawn + async write)
  await waitFor(()=> fs.existsSync(file), 8000);
  const before = await readJsonWithRetry<Record<string, unknown>>(file);
    // Call enrich
    send(server,{ jsonrpc:'2.0', id:3, method:'instructions/enrich', params:{} });
    await waitFor(()=> !!findResponse(out,3));
  // Wait for potential async rewrite completion (file may be rewritten transiently)
  await waitFor(()=> fs.existsSync(file), 8000);
  const after = await readJsonWithRetry<Record<string, unknown>>(file, 8000, 120);
    for(const f of ['owner','version','priorityTier','semanticSummary']){ expect(after[f]).toEqual(before[f]); }
    server.kill();
  }, 20000);
});
