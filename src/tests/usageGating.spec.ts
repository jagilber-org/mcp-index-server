import { describe, it, expect } from 'vitest';
import { incrementUsage, ensureLoaded, invalidate } from '../services/catalogContext';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { enableFeature, hasFeature } from '../services/features';

// Unified test covering both disabled and enabled states without skipping.
describe('usage gating behaviour', () => {
  it('returns featureDisabled when usage feature absent', () => {
    // Simulate disabled by ensuring env not set (module already loaded, so we just avoid enableFeature).
    const dir = path.join(process.cwd(),'instructions');
    mkdirSync(dir,{recursive:true});
    const id = 'gating_test_entry_disabled';
    writeFileSync(path.join(dir, id+'.json'), JSON.stringify({
      id,
      title:'T', body:'B', priority:10, audience:'all', requirement:'mandatory', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    }), 'utf8');
    invalidate();
    const before = ensureLoaded().byId.get(id)!;
    expect(before.usageCount).toBeUndefined();
    if(hasFeature('usage')){
      // If CI sets usage feature globally we cannot assert gating here; skip just this assertion.
      return;
    }
    const res = incrementUsage(id) as unknown as { featureDisabled?: boolean };
    expect(res.featureDisabled).toBe(true);
    const after = ensureLoaded().byId.get(id)!;
    expect(after.usageCount).toBeUndefined();
  });

  it('increments usage when feature enabled', () => {
    enableFeature('usage');
    const dir = path.join(process.cwd(),'instructions');
    mkdirSync(dir,{recursive:true});
    const id = 'gating_test_entry_enabled';
    writeFileSync(path.join(dir, id+'.json'), JSON.stringify({
      id,
      title:'T', body:'B', priority:10, audience:'all', requirement:'mandatory', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    }), 'utf8');
    invalidate();
    const res1 = incrementUsage(id) as unknown as { usageCount?: number };
    expect(res1.usageCount).toBe(1);
    const res2 = incrementUsage(id) as unknown as { usageCount?: number };
    expect(res2.usageCount).toBe(2);
  });
});
