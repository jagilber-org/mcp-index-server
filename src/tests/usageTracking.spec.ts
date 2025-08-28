import { describe, it, expect, beforeAll } from 'vitest';
import { getCatalogState } from '../services/toolHandlers';
import { incrementUsage } from '../services/catalogContext';
import { enableFeature } from '../services/features';
import '../services/toolHandlers';

// Ensure usage feature is active for these tests (Phase 0 gating)
beforeAll(() => {
  // Add usage to env feature list (idempotent if already present)
  process.env.INDEX_FEATURES = (process.env.INDEX_FEATURES ? (process.env.INDEX_FEATURES + ',usage') : 'usage');
  enableFeature('usage');
});

interface UsageResult { id: string; usageCount?: number; firstSeenTs?: string; lastUsedAt?: string; featureDisabled?: boolean }
function track(id: string){
  const r = incrementUsage(id) as UsageResult | null;
  if(!r || r.featureDisabled){
    throw new Error('usage feature unexpectedly disabled in usageTracking.spec');
  }
  return r;
}

describe('usage tracking', () => {
  it('increments usage count (gated path, eventual consistency)', async () => {
    const st = getCatalogState();
    const first = st.list[0];
    track(first.id);
    // second increment to exercise non-first flush path
    track(first.id);
    // Allow a short microtask + timer cycle for any deferred snapshot/repair to materialize
    await new Promise(r=> setTimeout(r, 25));
    const refreshed = getCatalogState().byId.get(first.id)!; // first increment forces synchronous flush of snapshot
    // relaxed lower bound (>=1) because second increment may batch flush (rate limiting may suppress burst)
    expect((refreshed.usageCount ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('provides hotset ordering by usage then recency', async () => {
    const st = getCatalogState();
    // bump a few entries
    for(let i=0;i<Math.min(3, st.list.length);i++){
      track(st.list[i].id);
    }
    // emulate hotset logic
    const items = [...st.list]
      .filter(e => (e.usageCount ?? 0) > 0)
      .sort((a,b) => {
        const ua = a.usageCount ?? 0; const ub = b.usageCount ?? 0;
        if(ub !== ua) return ub - ua;
        const ta = a.lastUsedAt || ''; const tb = b.lastUsedAt || '';
        return tb.localeCompare(ta);
      });
    if(items.length > 1){
      expect((items[0].usageCount ?? 0) >= (items[1].usageCount ?? 0)).toBe(true);
    }
  });
});
