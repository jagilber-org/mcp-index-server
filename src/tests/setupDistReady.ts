// Global test setup ensuring compiled dist artifacts exist before any test spawns the server.
// Centralizes previous per-spec waitForDist calls and reduces race-induced ENOENT/timeouts.
import { beforeAll } from 'vitest';
import { waitForDist } from './distReady';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// Lightweight ambient declarations to avoid requiring @types/node in test context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any; // provided by Node at runtime
// (Removed unused Buffer ambient to satisfy no-unused-vars; Node provides Buffer if needed.)

// Give this hook a timeout larger than the internal waitForDist window so we never fail *before* the poller
// exhausts its attempts. (Previous flake: hook default 10s < waitForDist 18s => premature 62‑suite cascades.)
// ----------------------------------------------------------------------------------
// Single‑run global initialization (production deploy drift sync only)
// ----------------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if(!g.__SETUP_DIST_READY_INIT){
  g.__SETUP_DIST_READY_INIT = true;
  try {
    if(process.env.SKIP_PROD_DEPLOY !== '1'){
      const prodDir = 'C:/mcp/mcp-index-server-prod';
      const prodPkg = path.join(prodDir, 'package.json');
      const workspacePkg = path.join(process.cwd(),'package.json');
      let needsDeploy = false;
      if(!fs.existsSync(prodPkg)) needsDeploy = true; else {
        try {
          const prodJson = JSON.parse(fs.readFileSync(prodPkg,'utf8')) as { version?: string };
          const wsJson = JSON.parse(fs.readFileSync(workspacePkg,'utf8')) as { version?: string };
          if(prodJson.version !== wsJson.version) needsDeploy = true;
        } catch { needsDeploy = true; }
      }
      if(!needsDeploy){
        try {
          const prodIndex = path.join(prodDir,'dist','server','index.js');
          const wsIndex = path.join(process.cwd(),'dist','server','index.js');
          if(!(fs.existsSync(prodIndex) && fs.existsSync(wsIndex))) needsDeploy = true; else {
            const prodM = fs.statSync(prodIndex).mtimeMs;
            const wsM = fs.statSync(wsIndex).mtimeMs;
            if(wsM > prodM + 1000) needsDeploy = true;
          }
        } catch { needsDeploy = true; }
      }
      if(needsDeploy){
        if(fs.existsSync(path.join(process.cwd(),'dist','server','index.js'))){
          // eslint-disable-next-line no-console
          console.log('[setupDistReady] Auto-deploying production build (detected drift)');
          const script = path.join(process.cwd(),'scripts','deploy-local.ps1');
          // Include -BundleDeps so production deployment has runtime dependencies preinstalled (avoids MODULE_NOT_FOUND like 'ajv').
          const args = ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File', script,'-Overwrite','-BundleDeps','-TargetDir','C:/mcp/mcp-index-server-prod'];
          const res = spawnSync('pwsh', args, { encoding:'utf8', stdio:'pipe' });
          if(res.error){
            // eslint-disable-next-line no-console
            console.error('[setupDistReady] production deploy failed (spawn error):', res.error.message);
          } else if(res.status !== 0){
            // eslint-disable-next-line no-console
            console.error('[setupDistReady] production deploy failed (exit code)', res.status, '\nSTDOUT:', res.stdout?.slice(0,2000), '\nSTDERR:', res.stderr?.slice(0,2000));
          } else {
            // eslint-disable-next-line no-console
            console.log('[setupDistReady] production deploy complete');
          }
        }
      }
    }
  } catch {/* ignore auto-deploy failures */}
}

beforeAll(async () => {
  const start = Date.now();
  const baseDefault = 18000 + (process.env.EXTEND_DIST_WAIT === '1' && !process.env.DIST_WAIT_MS ? 6000 : 0);
  const requested = process.env.DIST_WAIT_MS ? parseInt(process.env.DIST_WAIT_MS, 10) : baseDefault;
  const timeoutMs = isNaN(requested) ? 18000 : requested;
  const pollInterval = 50;
  const ok = await waitForDist(timeoutMs, pollInterval);
  const elapsed = Date.now() - start;
  const marker = path.join(process.cwd(), '.last-dist-wait-failed');
  if(!ok){
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch {/* ignore */}
    if(process.env.DIST_WAIT_DEBUG === '1'){
      const distDir = path.join(process.cwd(),'dist');
      const serverDir = path.join(distDir,'server');
      const distExists = fs.existsSync(distDir);
      const serverExists = fs.existsSync(serverDir);
      const listing = serverExists ? fs.readdirSync(serverDir).join(',') : '(missing)';
      // eslint-disable-next-line no-console
      console.error(`[setupDistReady] FAIL after ${elapsed}ms (timeout=${timeoutMs}). distExists=${distExists} serverDirExists=${serverExists} listing=${listing}`);
    }
    throw new Error('setupDistReady: dist/server/index.js did not materialize within timeout. Build may have failed.');
  } else if(fs.existsSync(marker)) {
    try { fs.unlinkSync(marker); } catch {/* ignore */}
  }
  if(process.env.DIST_WAIT_DEBUG === '1'){
    // eslint-disable-next-line no-console
    console.log(`[setupDistReady] dist/server/index.js detected after ${elapsed}ms (timeout=${timeoutMs})`);
  }
  try {
    const keep = path.join(process.cwd(),'dist','.keep');
    const rootKeep = path.join(process.cwd(),'.dist.keep');
    if(!fs.existsSync(keep)){
      fs.mkdirSync(path.dirname(keep),{recursive:true});
      fs.writeFileSync(keep,'test sentinel');
    }
    if(!fs.existsSync(rootKeep)){
      fs.writeFileSync(rootKeep,'persist dist between rapid test cycles');
    }
  } catch {/* ignore */}
}, 25000);
