// Global test setup ensuring compiled dist artifacts exist before any test spawns the server.
// Centralizes previous per-spec waitForDist calls and reduces race-induced ENOENT/timeouts.
import { beforeAll } from 'vitest';
import { waitForDist } from './distReady';
import fs from 'fs';
import path from 'path';

// Give this hook a timeout larger than the internal waitForDist window so we never fail *before* the poller
// exhausts its attempts. (Previous flake: hook default 10s < waitForDist 18s => premature 62‑suite cascades.)
beforeAll(async () => {
  const start = Date.now();
  // If EXTEND_DIST_WAIT=1, add a grace to default unless an explicit DIST_WAIT_MS provided.
  const baseDefault = 18000 + (process.env.EXTEND_DIST_WAIT === '1' && !process.env.DIST_WAIT_MS ? 6000 : 0);
  const requested = process.env.DIST_WAIT_MS ? parseInt(process.env.DIST_WAIT_MS, 10) : baseDefault;
  const timeoutMs = isNaN(requested) ? 18000 : requested;
  const pollInterval = 50;
  const ok = await waitForDist(timeoutMs, pollInterval);
  const elapsed = Date.now() - start;
  const marker = path.join(process.cwd(), '.last-dist-wait-failed');
  if(!ok){
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch {/* ignore */}
    // Extra diagnostics when debug enabled
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
  } else {
    if(fs.existsSync(marker)) try { fs.unlinkSync(marker); } catch {/* ignore */}
  }
  if(process.env.DIST_WAIT_DEBUG === '1'){
    // eslint-disable-next-line no-console
    console.log(`[setupDistReady] dist/server/index.js detected after ${elapsed}ms (timeout=${timeoutMs})`);
  }
  // Create / refresh sentinels (legacy dist/.keep plus repo-root .dist.keep) to avoid next build clean.
  const keep = path.join(process.cwd(),'dist','.keep');
  const rootKeep = path.join(process.cwd(),'.dist.keep');
  try {
    if(!fs.existsSync(keep)){
      fs.mkdirSync(path.dirname(keep),{recursive:true});
      fs.writeFileSync(keep,'test sentinel');
    }
    if(!fs.existsSync(rootKeep)){
      fs.writeFileSync(rootKeep,'persist dist between rapid test cycles');
    }
  } catch {/* non-fatal */}
}, 25000); // hook timeout (25s) > max wait (18s default or overridden)
