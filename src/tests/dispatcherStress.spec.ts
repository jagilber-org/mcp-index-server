import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

// Stress test to ensure dispatcher semantic errors (-32601 / -32602) are never downgraded to -32603 under rapid load.
// Fires a burst of invalid dispatch calls (missing action + unknown action) intermixed with a valid list action.
// Flakiness formerly observed as occasional -32603. This test will fail fast if any internal error surfaces.

describe('dispatcher semantic code stress', () => {
  it('never downgrades semantic dispatcher errors to -32603', async () => {
    const server = spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' }});
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    // init
    server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'stress', version:'0' }, capabilities:{ tools:{} } } })+'\n');
    await waitFor(()=> lines.some(l=> { try { const o=JSON.parse(l); return o.id===1; } catch { return false; } }), 2000);

    const ITER = 60; // adjustable; keep modest to bound runtime
    let nextId = 10;
    for(let i=0;i<ITER;i++){
      // Missing action
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId++, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{} } })+'\n');
      // Unknown action
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId++, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'__nope__'+i } } })+'\n');
      // Valid list (should succeed)
      server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: nextId++, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } })+'\n');
    }
    const finalId = nextId - 1;
    await waitFor(()=> lines.some(l=> { try { const o=JSON.parse(l); return o.id===finalId; } catch { return false; } }), 6000);

    // Scan all dispatcher responses we sent
    const badInternals: { id:number; code:number; line:string }[] = [];
    for(const l of lines){
      let parsed: unknown; try { parsed = JSON.parse(l); } catch { continue; }
      const o = parsed as { id?: number; error?: { code: number } };
      if(!o || o.id == null) continue;
      if(o.id >= 10 && o.id <= finalId){
        if(o.error){
          const code = o.error.code;
            if(code === -32603){ badInternals.push({ id:o.id, code, line:l }); }
            if(code !== -32601 && code !== -32602 && code !== -32603){ badInternals.push({ id:o.id, code, line:l }); }
        }
      }
    }
    server.kill();
    // Fail if any internal errors present (semantic downgrade)
    const downgraded = badInternals.filter(e=> e.code === -32603);
    expect(downgraded.length, 'Encountered downgraded internal errors: '+ JSON.stringify(downgraded.slice(0,5))).toBe(0);
  }, 15000);
});
