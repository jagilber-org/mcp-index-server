import { describe, it, expect, beforeAll } from 'vitest';
import http from 'http';
import { _parseArgs, _findPackageVersion, _startDashboard } from '../../server/index';
import fs from 'fs';
import path from 'path';
import { logInfo } from '../../services/logger';

// P1 coverage: exercise server helper exports and dashboard lifecycle

describe('server/index helper exports (P1)', () => {
  it('parseArgs parses dashboard flags', () => {
    const cfg = _parseArgs(['node','index','--dashboard','--dashboard-port=8999','--dashboard-host=127.0.0.1','--dashboard-tries=1']);
    expect(cfg.dashboard).toBe(true);
    expect(cfg.dashboardPort).toBe(8999);
    expect(cfg.dashboardHost).toBe('127.0.0.1');
    expect(cfg.maxPortTries).toBe(1);
  });

  it('findPackageVersion returns semver-like string', () => {
    const v = _findPackageVersion();
    expect(v).toMatch(/\d+\.\d+\.\d+/);
  });

  it('startDashboard starts and serves /tools.json then closes', async () => {
  const dash = await _startDashboard({ dashboard:true, dashboardPort: 0, dashboardHost: '127.0.0.1', maxPortTries: 5, legacy:false });
    expect(dash).not.toBeNull();
    if(!dash) return; // type narrowing
    const url = dash.url.replace(/\/$/, '') + '/tools.json';
    // Use Node http to avoid fetch socket issues in constrained CI
    const attemptFetch = ()=> new Promise<any>((resolve, reject)=>{
      http.get(url, (res) => {
        let buf='';
        res.on('data',(c:Buffer)=>buf+=c.toString());
        res.on('end',()=>{ try { resolve(JSON.parse(buf)); } catch(e){ reject(e);} });
      }).on('error',reject);
    });
    let json: any; let lastErr: unknown;
    for(let i=0;i<3;i++){
      try { json = await attemptFetch(); break; } catch(e){ lastErr=e; await new Promise(r=>setTimeout(r,25)); }
    }
    if(!json && lastErr) throw lastErr;
    expect(json).toHaveProperty('tools');
    dash.close();
  });
});

describe('logger file logging (P1)', () => {
  const tmpDir = path.join(process.cwd(),'tmp','logger-p1');
  const logFile = path.join(tmpDir,'test.log');
  beforeAll(()=>{ fs.mkdirSync(tmpDir,{recursive:true}); process.env.MCP_LOG_FILE = logFile; });
  it('writes log lines to file', async () => {
    logInfo('p1_test',{ sample: true });
    // wait a tick for async stream flush
    await new Promise(r=>setTimeout(r,25));
    const content = fs.readFileSync(logFile,'utf8');
    expect(content).toMatch(/p1_test/);
  });
});
