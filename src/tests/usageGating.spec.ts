import { describe, it, expect } from 'vitest';
import { incrementUsage, ensureLoaded, invalidate } from '../services/catalogContext';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

// This test assumes INDEX_FEATURES does NOT include 'usage'. If it does, skip.
const features = (process.env.INDEX_FEATURES||'').split(',').map(s=>s.trim()).filter(Boolean);
if(features.includes('usage')){
  describe.skip('usage gating (feature disabled)', () => {});
} else {
  describe('usage gating (feature disabled)', () => {
    it('incrementUsage returns featureDisabled marker and does not mutate entry usageCount', () => {
      // Seed a catalog entry directly in instructions dir
      const dir = path.join(process.cwd(),'instructions');
      mkdirSync(dir,{recursive:true});
      const id = 'gating_test_entry';
      writeFileSync(path.join(dir, id+'.json'), JSON.stringify({
        id,
        title:'T', body:'B', priority:10, audience:'all', requirement:'mandatory', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
      }), 'utf8');
      invalidate();
      const before = ensureLoaded().byId.get(id)!;
      expect(before.usageCount).toBeUndefined();
  const res = incrementUsage(id);
  expect((res as unknown as { featureDisabled?: boolean }).featureDisabled).toBe(true);
      const after = ensureLoaded().byId.get(id)!;
      expect(after.usageCount).toBeUndefined();
    });
  });
}
