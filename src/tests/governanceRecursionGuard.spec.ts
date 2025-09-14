import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Utility copied from other tests (lightweight) -------------------------------------------------
function send(proc: ReturnType<typeof spawn>, msg: unknown){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
// Legacy helper (kept for reference, no longer used) captured first JSON frame which could be a
// transport notification rather than the target id, leading to flaky field extraction.
// (legacy once helper removed after introducing id-filtered waiter)
// Deterministic JSON-RPC frame waiter filtering by id to avoid capturing unrelated frames.
function waitForId<T=any>(proc: ReturnType<typeof spawn>, id: number): Promise<T>{
  return new Promise((resolve)=>{
    const onData = (d: Buffer)=>{
      const lines = d.toString('utf8').split(/\r?\n/).filter(Boolean);
      for(const line of lines){
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        if(obj && Object.prototype.hasOwnProperty.call(obj,'id') && obj.id === id){
          proc.stdout?.off('data', onData);
          return resolve(obj as T);
        }
      }
    };
    proc.stdout?.on('data', onData);
  });
}

// ------------------------------------------------------------------------------------------------
// This test enforces that governance/spec seed artifacts are NOT ingested into the runtime
// instruction catalog and that recursionRisk remains 'none'. It provides a hard guard against
// future refactors accidentally widening ingestion scope.
// ------------------------------------------------------------------------------------------------

describe('governance recursion guard', () => {
  let proc: ReturnType<typeof spawn> | null = null;
  const INSTRUCTIONS_DIR = path.join(process.cwd(), 'instructions');
  beforeAll(() => {
    // Ensure instructions dir exists
    if(!fs.existsSync(INSTRUCTIONS_DIR)) fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
    proc = spawn('node',[path.join(__dirname,'../../dist/server/index.js')], {
      stdio: ['pipe','pipe','pipe'],
      env: { ...process.env, MCP_ENABLE_MUTATION:'', INSTRUCTIONS_DIR }
    });
  });
  afterAll(() => { try { proc?.kill(); } catch { /* ignore */ } });

  it('reports recursionRisk none and no governance seeds present', async () => {
    if(!proc) throw new Error('proc not started');
  // Full initialize first (aligns with MCP handshake ordering)
  send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'recursion-spec', version:'0.0.0' }, capabilities:{ tools:{} } } });
  await waitForId(proc,1);
  // tools/list to ensure downstream tool registration snapshot (defensive)
  send(proc,{ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
  await waitForId(proc,2);

  send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/health', arguments:{} } });
  const resp = await waitForId<{ jsonrpc?: string; result?: any; error?: any }>(proc,3);
    expect(resp.error).toBeUndefined();
    // Expanded extraction: account for tool returning plain object (result) or stringified JSON
    const extract = (env: any): any => {
      if(!env) return env;
      let r = env.result ?? env; // inner result or top-level
      if(r?.result) r = r.result; // nested result
      // Direct hit
      if(r && typeof r === 'object' && 'recursionRisk' in r) return r;
      // content envelope
      if(Array.isArray(r?.content)){
        for(const c of r.content){
          if(c?.data && typeof c.data === 'object' && 'recursionRisk' in c.data) return c.data;
          if(typeof c?.text === 'string'){
            try { const parsed = JSON.parse(c.text); if(parsed && typeof parsed === 'object' && 'recursionRisk' in parsed) return parsed; } catch { /* ignore */ }
          }
        }
      }
      // Some legacy paths may wrap under data
      if(r?.data && typeof r.data === 'object' && 'recursionRisk' in r.data) return r.data;
      return r;
    };
    const r = extract(resp);
    expect(r).toBeTruthy();
    expect(r.recursionRisk).toBe('none');
    // Leakage metrics exist and are small
    expect(r.leakage).toBeTruthy();
    expect(typeof r.leakage.leakageRatio).toBe('number');
    expect(r.leakage.leakageRatio).toBeLessThan(0.01);
    // Assert no bootstrapper/lifecycle ids accidentally present
    const forbiddenIds = ['000-bootstrapper','001-knowledge-index-lifecycle'];
    const forbiddenPresent = (r.missing||[]).filter((id:string)=> forbiddenIds.includes(id)).length === 0 && forbiddenIds.every(fid => !(r.extra||[]).includes(fid));
    // Stronger guard: query catalog listing via dispatcher diff (list indirect) to ensure absence
    send(proc,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
  const listResp = await waitForId<{ result?: any }>(proc,4);
    const items = listResp.result?.items || listResp.result?.list || listResp.result?.entries || [];
    for(const fid of forbiddenIds){
      const match = items.find((i: { id:string }) => i.id === fid);
      expect(match, `Forbidden governance seed appeared in catalog: ${fid}`).toBeUndefined();
    }
    expect(forbiddenPresent).toBe(true);
  }, 20000);
});
