process.env.INDEX_FEATURES = process.env.INDEX_FEATURES ? process.env.INDEX_FEATURES + ',usage' : 'usage';
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { incrementUsage } from '../services/catalogContext';
import { enableFeature } from '../services/features';
import { getCatalogState } from '../services/toolHandlers';
import '../services/toolHandlers';
import { waitFor } from './testUtils';

interface UsageResult { id?:string; usageCount?:number; firstSeenTs?:string; lastUsedAt?:string; featureDisabled?:boolean }

// helper exported via toolHandlers wrapper
function usageSnapshotPath(){ return path.join(process.cwd(),'data','usage-snapshot.json'); }

describe('firstSeenTs persistence', () => {
  it('sets firstSeenTs and preserves it across increments & flush (tight)', async () => {
    // Enable feature before touching catalog to avoid race with initial load
    enableFeature('usage');
    const st = getCatalogState();
    const entry = st.list[0];
    const snap = usageSnapshotPath();
    if(fs.existsSync(snap)) fs.unlinkSync(snap);

    // Initial increment with retry loop if featureDisabled path encountered (rare ordering race)
  let r1: UsageResult | null | undefined; let attempts = 0;
    do {
      r1 = incrementUsage(entry.id);
      if(r1 && !r1.featureDisabled) break;
      enableFeature('usage');
      await new Promise(r=> setTimeout(r, 50));
    } while(++attempts < 5);

  // Require immediate establishment; fail fast if missing
  const first = r1?.firstSeenTs;
  expect(first, 'firstSeenTs missing after initial increment').toBeTruthy();

    // Second increment - should not change firstSeenTs
  const r2 = incrementUsage(entry.id) as UsageResult | null;
  expect(r2?.firstSeenTs).toBe(first);
  expect(getCatalogState().byId.get(entry.id)?.firstSeenTs).toBe(first);

    // Wait for snapshot file creation & content
    await waitFor(()=> fs.existsSync(snap), 4000, 60);
    await waitFor(()=> {
      try {
        const json = JSON.parse(fs.readFileSync(snap,'utf8')) as Record<string, { firstSeenTs?: string }>;
        return !!json[entry.id]?.firstSeenTs;
      } catch { return false; }
    }, 2000, 60).catch(()=>{});

  const snapshot = JSON.parse(fs.readFileSync(snap,'utf8')) as Record<string, { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string }>;
  expect(snapshot[entry.id].firstSeenTs).toBe(first);
  expect(snapshot[entry.id].lastUsedAt).toBeTruthy();
  }, 10000);
});
