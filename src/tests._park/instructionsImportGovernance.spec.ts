import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { waitFor, findResponse, ensureDir, ensureFileExists } from './testUtils';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
// Using shared findResponse

describe('instructions/import preserves governance fields', () => {
  const instructionsDir = path.join(process.cwd(),'instructions');
  beforeAll(()=>{ ensureDir(instructionsDir); });

  it('imports entries with explicit governance untouched', async () => {
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'coverage', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findResponse(out,1));

    const ids = Array.from({ length:3 }, (_,i)=> `import_gov_${Date.now()}_${i}`);
    const entries = ids.map((id,i)=> ({ id, title:id, body:`Body ${i}`, priority:10*(i+1), audience:'all', requirement:'optional', categories:['Import','Temp'], version:`3.0.${i}`, owner:`import-owner-${i}`, priorityTier:'P1', classification:'internal', semanticSummary:`Imported summary ${i}`, changeLog:[{ version:`3.0.${i}`, changedAt:new Date().toISOString(), summary:'seed' }] }));

  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/import', arguments:{ entries, mode:'overwrite' } } });
    await waitFor(()=> !!findResponse(out,2));

    // Verify each file on disk retains governance fields
    for(let i=0;i<ids.length;i++){
      const id=ids[i];
      const file = path.join(instructionsDir, id + '.json');
  await ensureFileExists(file, 6000);
      const disk = JSON.parse(fs.readFileSync(file,'utf8')) as { version:string; owner:string; priorityTier:string; classification:string; semanticSummary:string; changeLog:{ version:string; changedAt:string; summary:string }[] };
      expect(disk.version).toBe(`3.0.${i}`);
      expect(disk.owner).toBe(`import-owner-${i}`);
      expect(disk.priorityTier).toBe('P1');
      expect(disk.classification).toBe('internal');
      expect(disk.semanticSummary).toBe(`Imported summary ${i}`);
      expect(disk.changeLog[0].version).toBe(`3.0.${i}`);
    }

    server.kill();
  }, 15000);
});
