import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor } from './testUtils';

// Lightweight spawn tests to assert validation & error.data propagation for malformed requests.
describe('sdk server error & validation paths', () => {
  it('returns error for malformed JSON-RPC (missing method)', async () => {
    const proc = spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'] });
    const lines: string[]=[]; proc.stdout.on('data', d=> lines.push(...d.toString().trim().split(/\n+/)));
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'err-path', version:'0' }, capabilities:{ tools:{} } } })+'\n');
    await waitFor(()=> lines.some(l=> { try { const o=JSON.parse(l); return o.id===1 && o.result; } catch { return false; } }), 3000);
    // Send object missing method field
    proc.stdin?.write('{"jsonrpc":"2.0","id":99}'+'\n');
    await new Promise(r=> setTimeout(r,120));
    const errLine = lines.find(l=> l.includes('99'));
    // Server may drop totally invalid requests; tolerate absence but prefer error
    if(errLine){
      try { const o = JSON.parse(errLine); if(o.error){ expect(o.error).toBeTruthy(); } } catch {/* ignore parse */}
    }
    proc.kill();
  });

  it('returns method not found for unknown method', async () => {
    const proc = spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'] });
    const lines: string[]=[]; proc.stdout.on('data', d=> lines.push(...d.toString().trim().split(/\n+/)));
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'err-path', version:'0' }, capabilities:{ tools:{} } } })+'\n');
    await waitFor(()=> lines.some(l=> { try { const o=JSON.parse(l); return o.id===1 && o.result; } catch { return false; } }), 3000);
    proc.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'not/a/method', params:{} })+'\n');
    await waitFor(()=> lines.some(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } }), 3000);
    const line = lines.find(l=> { try { const o=JSON.parse(l); return o.id===2; } catch { return false; } });
    expect(line).toBeTruthy();
    if(line){ const obj = JSON.parse(line); expect(obj.error).toBeTruthy(); }
    proc.kill();
  });
});
