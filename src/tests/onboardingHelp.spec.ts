import { spawn } from 'child_process';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';

function send(proc: ReturnType<typeof spawn>, msg: unknown){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function collectUntil(proc: ReturnType<typeof spawn>, predicate: (obj: any)=>boolean, timeoutMs=5000): Promise<any>{
  return new Promise((resolve, reject)=>{
    const start = Date.now();
    const onData = (d: Buffer)=>{
      const lines = d.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
      for(const line of lines){
        try { const obj = JSON.parse(line); if(predicate(obj)){ proc.stdout?.off('data', onData); return resolve(obj); } } catch { /* ignore */ }
      }
      if(Date.now() - start > timeoutMs){ proc.stdout?.off('data', onData); reject(new Error('timeout waiting for predicate')); }
    };
    proc.stdout?.on('data', onData);
  });
}

describe('help/overview onboarding guidance', () => {
  const serverPath = path.join(__dirname,'../../dist/server/index.js');
  const env = { ...process.env };
  let proc: ReturnType<typeof spawn> | null = null;
  afterAll(()=>{ try { proc?.kill(); } catch { /* ignore */ } });

  it('returns structured onboarding payload with required sections', async () => {
    proc = spawn('node',[serverPath], { stdio:['pipe','pipe','pipe'], env });
    // initialize
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'onboarding-test', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await collectUntil(proc, o=> o.id===1 || !!o.result?.capabilities);
    // tools list (meta/tools via tools/call) to ensure help tool registered
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta/tools', arguments:{} } });
    const meta = await collectUntil(proc, o=> o.id===2);
    expect(meta.error).toBeUndefined();
    const metaTextTools = JSON.stringify(meta);
    expect(metaTextTools).toContain('help/overview');
    // call help/overview
    send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'help/overview', arguments:{} } });
    const help = await collectUntil(proc, o=> o.id===3);
    expect(help.error).toBeUndefined();
    // Robust extraction across possible envelope shapes similar to governanceRecursionGuard
    function extract(env: any): any {
      if(!env) return env;
      let r = env.result ?? env;
      if(r?.result) r = r.result;
      // Some envelope variants may return a JSON string directly as result
      if(typeof r === 'string'){
        try { const parsed = JSON.parse(r); if(parsed && parsed.generatedAt && parsed.sections) return parsed; } catch { /* ignore */ }
      }
      if(r?.data && typeof r.data === 'object') return r.data;
      if(r && typeof r === 'object' && r.generatedAt && r.sections) return r;
      if(Array.isArray(r?.content)){
        for(const c of r.content){
          if(c && typeof c === 'object'){
            if(c.data && typeof c.data === 'object' && c.data.generatedAt) return c.data;
            if(typeof c.text === 'string'){
              try { const obj = JSON.parse(c.text); if(obj && obj.generatedAt && obj.sections) return obj; } catch { /* ignore */ }
            }
          }
        }
      }
      return r;
    }
    const result = extract(help);
    expect(result).toBeTruthy();
    expect(result.generatedAt).toBeTruthy();
    expect(result.version).toBeTruthy();
    expect(Array.isArray(result.sections)).toBe(true);
    const sectionIds = result.sections.map((s: any)=> s.id);
    for(const required of ['intro','discovery','lifecycle','promotion','mutation-safety','recursion-safeguards','next-steps']){
      expect(sectionIds).toContain(required);
    }
    // verify lifecycleModel + checklist presence
    expect(result.lifecycleModel?.tiers?.length).toBeGreaterThan(0);
    expect(result.lifecycleModel?.promotionChecklist?.length).toBeGreaterThan(3);
    // toolDiscovery structure
    expect(Array.isArray(result.toolDiscovery.primary)).toBe(true);
    expect(result.toolDiscovery.primary.length).toBeGreaterThan(5);
  }, 15000);
});
