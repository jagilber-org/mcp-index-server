import { describe, it, expect } from 'vitest';
import * as perfMod from '../services/performanceBaseline';
import { runPerformanceBaseline } from '../services/performanceBaseline';

// Lightweight test: patch internal heavy measurement helpers with small deterministic arrays
// to exercise summary math and file output path logic without long-running timing loops.

describe('performanceBaseline lightweight', () => {
  it('computes summary with stubbed timings', async () => {
    (perfMod as any).measureListOperations = async (enable: boolean) => enable ? [2,2,2] : [1,1,1];
    (perfMod as any).measureMutationOperations = async (enable: boolean) => enable ? [4,4,4] : [2,2,2];

    const results = await runPerformanceBaseline();
    expect(results.summary.listOverheadPercent).toBeGreaterThan(0);
    expect(results.summary.mutationOverheadPercent).toBeGreaterThan(0);
    expect(typeof results.summary.meetsTarget).toBe('boolean');
  }, 10_000);
});
