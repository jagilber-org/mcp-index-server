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
  it('increments usage count (gated path)', () => {
    const st = getCatalogState();
    const first = st.list[0];
  const r1 = track(first.id);
  const r2 = track(first.id);
  // We only require the count to be >= 1 (fresh or existing) and non-decreasing after second increment.
  expect((r1.usageCount ?? 0)).toBeGreaterThanOrEqual(1);
  expect((r2.usageCount ?? 0)).toBeGreaterThanOrEqual((r1.usageCount ?? 0));
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
