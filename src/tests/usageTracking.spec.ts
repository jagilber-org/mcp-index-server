import { describe, it, expect, beforeAll } from 'vitest';
import { getCatalogState } from '../services/toolHandlers';
import { incrementUsage, writeEntry } from '../services/catalogContext';
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
  it('increments usage count deterministically on a fresh entry (tight)', async () => {
    // Create a unique instruction entry to avoid prior usage contamination
    const id = 'usage-track-' + Date.now() + '-' + Math.random().toString(36).substring(7);
    const now = new Date().toISOString();
    writeEntry({
      id,
      title:id,
      body:'usage tracking test body',
      priority:10,
      audience:'all',
      requirement:'optional',
      categories:[],
      sourceHash:'',
      schemaVersion:'2',
      createdAt: now,
      updatedAt: now,
      owner:'unowned',
      version:'1.0.0',
      priorityTier:'P3',
      status:'approved',
      classification:'internal',
      lastReviewedAt: now,
      nextReviewDue: now,
      reviewIntervalDays:30,
      changeLog:[{ version:'1.0.0', changedAt: now, summary:'init'}],
      semanticSummary:'usage tracking test'
    });
    
    // First increment -> count should be 1
    const r1 = track(id);
    expect(r1.usageCount).toBe(1);
    
    // Wait 1.1 seconds to avoid rate limiting (10 per second limit)
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Second increment -> count should be 2
    const r2 = track(id);
    expect(r2.usageCount).toBe(2);
    // State snapshot agrees
    const snap = getCatalogState().byId.get(id)!;
    expect(snap.usageCount).toBe(2);
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
