import { describe, it, expect } from 'vitest';
import { registerHandler, getHandler, getMetricsRaw } from '../server/registry';

describe('registry core', () => {
  it('records metrics for handler', async () => {
    registerHandler('unit/testMetric', () => 'ok');
    const h = getHandler('unit/testMetric');
    expect(h).toBeTruthy();
    await Promise.all([h!({}), h!({}), h!({})]);
    const raw = getMetricsRaw();
    expect(raw['unit/testMetric'].count).toBeGreaterThanOrEqual(3);
  });
});
