import { describe, it, expect } from 'vitest';
import { featureStatus, hasFeature } from '../services/features';

// Phase 0 scaffold test; relies on INDEX_FEATURES env if set during run.
// Skipped by default to avoid coupling CI unless explicitly enabled.
describe.skip('feature/status tool scaffold', () => {
  it('reports active features consistently', () => {
    const st = featureStatus();
    for(const f of st.features){ expect(hasFeature(f)).toBe(true); }
  });
});
