import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){ return spawn('node',[path.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } }); }
function send(p:ReturnType<typeof startServer>, msg:Record<string,unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

// Performance guard: add a moderately large instruction and exercise diff/export to ensure
// operations complete within a soft SLA (e.g., diff < 2s, export < 2s). This is a smoke test,
// not a strict benchmark – thresholds may be adjusted if CI proves noisy.

describe('diff/export performance over large markdown corpus', () => {
  it('completes diff & export under soft SLA', async () => {
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,140));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'diff-perf', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findLine(out,1));

    const id = 'diff-perf-' + Date.now();
    const body = Array.from({ length: 180 }, (_,i)=> `Line ${i} - https://example.com/resource/${i} Service Fabric Azure Bicep`).join('\n');
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Diff Perf', body, priority:45, audience:'all', requirement:'optional', categories:['performance'] }, overwrite:true, lax:true } } });
    await waitFor(()=> !!findLine(out,2));

    // Trigger a diff with bogus client hash -> should return full diff payload quickly
    const startDiff = Date.now();
    send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'diff', clientHash:'bogus' } } });
    await waitFor(()=> !!findLine(out,3), 6000);
    const diffDur = Date.now() - startDiff;
    expect(diffDur).toBeLessThan(2000);

    // Export snapshot
    const startExport = Date.now();
    send(server,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'export' } } });
    await waitFor(()=> !!findLine(out,4), 6000);
    const exportDur = Date.now() - startExport;
    expect(exportDur).toBeLessThan(2000);

    // Basic shape verification (optional)
    const diffPayload = parseToolPayload<Record<string, unknown>>(findLine(out,3)!);
    expect(typeof diffPayload).toBe('object');

    server.kill();
  }, 20000);
});
