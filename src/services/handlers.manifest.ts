import { registerHandler } from '../server/registry';
import { computeManifestDrift, loadManifest, repairManifest, writeManifestFromCatalog } from './manifestManager';
import { ensureLoaded } from './catalogContext';

// manifest/status: returns current drift (without repairing) and manifest presence.
registerHandler('manifest/status', ()=>{
  const st = ensureLoaded();
  const manifest = loadManifest();
  const drift = computeManifestDrift();
  return { hash: st.hash, manifestPresent: !!manifest, count: st.list.length, drift: drift.drift, details: drift.details.slice(0,25) };
});

// manifest/refresh: force rewrite from current catalog (non-mutating to catalog itself)
registerHandler('manifest/refresh', ()=>{
  const st = ensureLoaded();
  const manifest = writeManifestFromCatalog();
  return { refreshed: !!manifest, count: manifest?.count ?? 0, hash: st.hash };
});

// manifest/repair: recompute manifest if drift present.
registerHandler('manifest/repair', ()=>{
  const st = ensureLoaded();
  const result = repairManifest();
  return { hash: st.hash, ...result };
});

export {};
