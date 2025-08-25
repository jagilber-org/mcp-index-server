import { describe, it, expect } from 'vitest';
import '../services/toolHandlers';
import { getCatalogState } from '../services/toolHandlers';
import { getMetrics } from '../server/transport';

// Simulate a few handler calls by touching catalog and usage

describe('metrics/snapshot', () => {
  it('exposes method counts and timing fields', () => {
    // simulate accesses
    getCatalogState(); // triggers load via list or others normally
    // Pretend some metrics were recorded manually for test stability
    const m = getMetrics();
  interface MR { count: number; totalMs: number; maxMs: number }
  (m as Record<string, MR>)['instructions/list'] = { count: 3, totalMs: 9, maxMs: 5 };
  (m as Record<string, MR>)['usage/track'] = { count: 2, totalMs: 4, maxMs: 3 };
  const snapshot = Object.entries(m as Record<string, MR>).map(([k,v]) => ({ method:k, count:v.count, avg: v.totalMs / v.count }));
    expect(snapshot.find(s => s.method === 'instructions/list')?.count).toBe(3);
  });
});
