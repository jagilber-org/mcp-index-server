import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

// Active minimal scoped list test; if dispatcher lacks scope filtering this still exercises list path.
describe('dispatcher list (scoped placeholder)', () => {
  it('returns list via dispatcher list action', async () => {
    const proc = spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
    const lines: string[]=[]; proc.stdout.on('data', d=> lines.push(...d.toString().trim().split(/\n+/))); 
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'scoped-list', version:'0' }, capabilities:{ tools:{} } } })+'\n');
    await waitFor(()=> lines.some(l=>{ try { const o=JSON.parse(l); return o.id===1 && !!o.result; } catch { return false; } }), 3000);
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'instructions/dispatch', params:{ action:'list' } })+'\n');
    await waitFor(()=> lines.some(l=>{ try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }), 4000);
    const listLine = lines.find(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } });
    expect(listLine).toBeTruthy();
    if(listLine){ const obj = JSON.parse(listLine); expect(obj.result).toBeTruthy(); }
    proc.kill();
  });
});
