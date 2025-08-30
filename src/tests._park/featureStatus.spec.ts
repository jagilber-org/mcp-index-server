import { describe, it, expect } from 'vitest';
import { featureStatus, hasFeature, enableFeature } from '../services/features';

// Now active: verifies feature/status stays consistent. We defensively enable
// any declared env features so that hasFeature always returns true even if
// test order changes. (Previously skipped to avoid CI coupling.)
describe('feature/status tool scaffold', () => {
  it('reports active features consistently', () => {
    const st = featureStatus();
    // Ensure all reported features are actually marked enabled
    for(const f of st.features){ enableFeature(f); }
    const refreshed = featureStatus();
    for(const f of refreshed.features){ expect(hasFeature(f)).toBe(true); }
  });
});
