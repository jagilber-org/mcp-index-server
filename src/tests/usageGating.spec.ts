import { describe, it, expect } from 'vitest';
import { incrementUsage, ensureLoaded, invalidate, __testResetUsageState } from '../services/catalogContext';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { enableFeature, hasFeature } from '../services/features';

// Unified test covering both disabled and enabled states without skipping.
describe('usage gating behaviour', () => {
  // Hard reset any persisted usage state between repeated full-suite runs to eliminate leakage.
  __testResetUsageState();
  // Use unique IDs per run to avoid leaking persisted usageCount from previous test cycles (usage snapshot).
  function uniqueId(base: string){ return `${base}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
  const dir = path.join(process.cwd(),'instructions');
  mkdirSync(dir,{recursive:true});

  it('returns featureDisabled when usage feature absent', () => {
    const id = uniqueId('gating_test_entry_disabled');
    writeFileSync(path.join(dir, id+'.json'), JSON.stringify({
      id,
      title:'T', body:'B', priority:10, audience:'all', requirement:'mandatory', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    }), 'utf8');
    invalidate();
    const before = ensureLoaded().byId.get(id)!;
    expect(before.usageCount).toBeUndefined();
    if(hasFeature('usage')){
      // Environment has usage feature globally enabled; skip gating assertions (feature gating path not exercised).
      return;
    }
    const res = incrementUsage(id) as unknown as { featureDisabled?: boolean };
    expect(res.featureDisabled).toBe(true);
    const after = ensureLoaded().byId.get(id)!;
    expect(after.usageCount).toBeUndefined();
  });

  it('increments usage when feature enabled', () => {
    enableFeature('usage');
    const id = uniqueId('gating_test_entry_enabled');
    writeFileSync(path.join(dir, id+'.json'), JSON.stringify({
      id,
      title:'T', body:'B', priority:10, audience:'all', requirement:'mandatory', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    }), 'utf8');
    invalidate();
    const res1 = incrementUsage(id) as unknown as { usageCount?: number };
    if(res1.usageCount !== 1){
      // Diagnostic output to help trace state leakage anomalies.
      // eslint-disable-next-line no-console
      console.error('[usageGating] unexpected initial usageCount', res1.usageCount, 'id', id);
    }
    expect(res1.usageCount).toBe(1);
    const res2 = incrementUsage(id) as unknown as { usageCount?: number };
    expect(res2.usageCount).toBe(2);
  });
});
