/**
 * Isolation handshake test against minimal PowerShell stdio MCP server.
 * Validates initialize ordering + tools/list + ping using raw JSON-RPC frames.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

interface Frame { jsonrpc?: string; id?: number; method?: string; result?: any; error?: any; params?: any }
const parse = (l:string):Frame|undefined => { try { return JSON.parse(l); } catch { return undefined; } };

function runPwshServer(){
  const child = spawn('pwsh', ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/powershell-mcp-server.ps1'], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
  return child;
}

describe('PowerShell MCP Server Handshake (isolation)', () => {
  it('initialize -> server/ready -> tools/list_changed -> tools/list -> ping', async () => {
    const child = runPwshServer();
    const frames: Frame[] = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
       for(const line of String(chunk).split(/\n+/).filter(Boolean)){
         const f = parse(line); if(f) frames.push(f);
       }
    });
    child.stderr.on('data', ()=>{});
    const send = (o:unknown)=> child.stdin.write(JSON.stringify(o)+'\n');
    send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'iso-test', version:'1.0.0' } } });
    let init=-1, ready=-1, changed=-1;
    const deadline=Date.now()+4000;
    while(Date.now()<deadline){
      init = frames.findIndex(f=>f.id===1 && f.result);
      if(init>=0){
        ready = frames.findIndex((f,i)=> i>init && f.method==='server/ready');
        changed = frames.findIndex((f,i)=> i>ready && f.method==='notifications/tools/list_changed');
        if(ready>=0 && changed>=0) break;
      }
      await new Promise(r=>setTimeout(r,25));
    }
    expect(init).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(init);
    expect(changed).toBeGreaterThan(ready);
    // list
    send({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
    let listResp: Frame|undefined; const listEnd=Date.now()+1500;
    while(Date.now()<listEnd && !listResp){ listResp = frames.find(f=>f.id===2 && (f.result||f.error)); if(!listResp) await new Promise(r=>setTimeout(r,25)); }
    expect(listResp && listResp.result && Array.isArray(listResp.result.tools) && listResp.result.tools.length>0).toBe(true);
    // ping
    send({ jsonrpc:'2.0', id:3, method:'ping', params:{} });
    let pingResp: Frame|undefined; const pingEnd=Date.now()+1000;
    while(Date.now()<pingEnd && !pingResp){ pingResp = frames.find(f=>f.id===3 && (f.result||f.error)); if(!pingResp) await new Promise(r=>setTimeout(r,20)); }
    expect(pingResp && pingResp.result && pingResp.result.timestamp).toBeTruthy();
  try { child.kill(); } catch { /* ignore */ }
  }, 10000);
});