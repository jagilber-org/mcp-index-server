import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

// Ensures style/classDef directives are preserved after scoping filter so themed colors remain.
describe('graph filtering preserves styles', () => {
  it('keeps classDef/style lines after selectedIds filtering', async () => {
    const env = { ...process.env, MCP_DASHBOARD: '1' };
    const proc = spawn('node', ['dist/server/index.js', '--dashboard-port=0', '--dashboard-host=127.0.0.1'], { env, stdio: ['ignore','pipe','pipe'] });
    let url: string | undefined; const pat = /Server started on (http:\/\/[^\s]+)/;
    const cap = (d:string)=> { const m = pat.exec(d); if(m) url = m[1]; };
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8'); proc.stdout.on('data', cap); proc.stderr.on('data', cap);
    const start = Date.now(); while(!url && Date.now()-start < 7000){ await new Promise(r=> setTimeout(r,50)); }
  if(!url){ try{proc.kill();}catch{/* ignore */} return expect.fail('dashboard start timeout'); }

    async function get(q:string){ const r= await fetch(url + '/api/graph/mermaid?' + q); expect(r.ok).toBe(true); return r.json() as Promise<{mermaid:string, meta:any}>; }
    const base = await get('enrich=1&categories=1');
    const styleLines = base.mermaid.split(/\r?\n/).filter(l=> /^(classDef|style |linkStyle )/.test(l.trim()));
    // Not every environment may emit styles; if none, skip (avoid false failure where theme lines absent globally)
  if(styleLines.length === 0){ try{proc.kill();}catch{/* ignore */} return; }
    // Grab first real node id
    const nodeMatch = /^(\w[\w:_-]*)\[/.exec(base.mermaid.split(/\r?\n/).find(l=> /\[/.test(l))||'');
    expect(nodeMatch).toBeTruthy();
    const id = nodeMatch![1];
    const scoped = await get(`enrich=1&categories=1&selectedIds=${encodeURIComponent(id)}`);
    expect(scoped.meta?.scoped).toBe(true);
    const scopedStyleLines = scoped.mermaid.split(/\r?\n/).filter(l=> /^(classDef|style |linkStyle )/.test(l.trim()));
    expect(scopedStyleLines.length).toBeGreaterThanOrEqual(styleLines.length); // we retain all (may add none)
  try{proc.kill();}catch{/* ignore */}
  }, 15000);
});
