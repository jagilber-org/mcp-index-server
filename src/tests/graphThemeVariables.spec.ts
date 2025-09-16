import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

describe('graph frontmatter themeVariables', () => {
  it('injects single themeVariables block and preserves after filtering', async () => {
    const env = { ...process.env, MCP_DASHBOARD:'1' };
    const proc = spawn('node', ['dist/server/index.js','--dashboard-port=0','--dashboard-host=127.0.0.1'], { env, stdio:['ignore','pipe','pipe'] });
    let url: string|undefined; const pat = /Server started on (http:\/\/[^\s]+)/; const cap=(d:string)=>{ const m=pat.exec(d); if(m) url=m[1]; };
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8'); proc.stdout.on('data',cap); proc.stderr.on('data',cap);
    const start = Date.now(); while(!url && Date.now()-start < 7000){ await new Promise(r=> setTimeout(r,50)); }
    if(!url){ try{proc.kill();}catch{/* ignore */} return expect.fail('dashboard start timeout'); }
    async function get(q:string){ const r = await fetch(url + '/api/graph/mermaid?' + q); expect(r.ok).toBe(true); return r.json() as Promise<{mermaid:string, meta:any}>; }
    const base = await get('enrich=1&categories=1');
    const trimmed = base.mermaid.replace(/^\uFEFF?/, '');
  // Allow optional leading whitespace/BOM before frontmatter; assert structured frontmatter exists
  expect(/^-{3}\nconfig:\n\s+theme:/m.test(trimmed)).toBe(true);
    const themeVarsCountBase = (base.mermaid.match(/\bthemeVariables:/g)||[]).length;
    expect(themeVarsCountBase).toBe(1);
    // pick first node id
    const nodeId = (base.mermaid.match(/^([A-Za-z0-9:_-]+)\[/m)||[])[1];
    expect(nodeId).toBeTruthy();
    const scoped = await get(`enrich=1&categories=1&selectedIds=${encodeURIComponent(nodeId!)}`);
    expect(scoped.meta?.scoped).toBe(true);
    const themeVarsCountScoped = (scoped.mermaid.match(/\bthemeVariables:/g)||[]).length;
    expect(themeVarsCountScoped).toBe(1);
    try{proc.kill();}catch{/* ignore */}
  },15000);
});
