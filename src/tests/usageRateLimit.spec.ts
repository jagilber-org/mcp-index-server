import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { incrementUsage, writeEntry, removeEntry, clearUsageRateLimit } from '../services/catalogContext';
import { enableFeature } from '../services/features';
import '../services/toolHandlers';

// Phase 1 Rate Limiting Tests
// NOTE: These tests pass when run in isolation but may fail when run with the full test suite
// due to test environment state contamination. The core functionality works correctly.
beforeAll(() => {
  process.env.INDEX_FEATURES = (process.env.INDEX_FEATURES ? (process.env.INDEX_FEATURES + ',usage') : 'usage');
  enableFeature('usage');
  // Clear all rate limiting state to start fresh
  clearUsageRateLimit();
});


describe('usage rate limiting (Phase 1)', () => {
  const testId = 'rate-limit-test-entry';
  const testEntry = {
    id: testId,
    title: 'Test Entry for Rate Limiting',
    body: 'Test entry used for rate limiting tests',
    priority: 1,
    audience: 'individual' as const,
    requirement: 'optional' as const,
    categories: [],
    sourceHash: 'test-hash',
    schemaVersion: '1.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  beforeEach(async () => {
    // Clean up any existing entry and rate limit state
    try {
      removeEntry(testId);
    } catch { /* ignore cleanup errors */ }
    
    // Clear ALL rate limiter state to avoid contamination from other tests
    clearUsageRateLimit();
    
    // Add test entry
    writeEntry(testEntry);
  });

  it('allows increments within rate limit (10 per second)', () => {
    const results = [];
    
    // Should allow up to 10 increments per second
    for (let i = 0; i < 10; i++) {
      const result = incrementUsage(testId);
      results.push(result);
    }
    
    // All requests should succeed
    for (const result of results) {
      expect(result).toBeTruthy();
      expect(result).not.toHaveProperty('rateLimited');
      expect(result).not.toHaveProperty('featureDisabled');
    }
  });

  it('blocks increments exceeding rate limit', () => {
    // Deterministically freeze time so all increments occur in the same 1s window
    const base = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => base);
    try {
      for (let i = 0; i < 10; i++) {
        const r = incrementUsage(testId);
        expect(r).not.toHaveProperty('rateLimited');
      }
      const blocked = incrementUsage(testId);
      expect(blocked).toHaveProperty('rateLimited', true);
    } finally {
      spy.mockRestore();
    }
  });

  it('resets rate limit in new time window', () => {
    // Mock time and manually advance to simulate window rollover without real waits
    const base = Date.now();
    let current = base;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => current);
    try {
      for (let i = 0; i < 10; i++) {
        const r = incrementUsage(testId);
        expect(r).not.toHaveProperty('rateLimited');
      }
      const blocked = incrementUsage(testId);
      expect(blocked).toHaveProperty('rateLimited', true);
      // Advance one full second to trigger new window
      current = base + 1000;
      const allowed = incrementUsage(testId);
      expect(allowed).toBeTruthy();
      expect(allowed).not.toHaveProperty('rateLimited');
    } finally {
      spy.mockRestore();
    }
  });

  it('tracks separate rate limits per id', () => {
    const id1 = 'rate-test-1';
    const id2 = 'rate-test-2';
    
    // Clear any existing rate limit state for these IDs
    clearUsageRateLimit(id1);
    clearUsageRateLimit(id2);
    
    // Create test entries for both IDs
    const testEntry1 = { ...testEntry, id: id1 };
    const testEntry2 = { ...testEntry, id: id2 };
    writeEntry(testEntry1);
    writeEntry(testEntry2);
    
    // Fill rate limit for id1
    for (let i = 0; i < 10; i++) {
      const result = incrementUsage(id1);
      expect(result).not.toHaveProperty('rateLimited');
    }
    
    // id1 should be blocked
    const blocked = incrementUsage(id1);
    expect(blocked).toHaveProperty('rateLimited', true);
    
    // id2 should still work
    const allowed = incrementUsage(id2);
    expect(allowed).toBeTruthy();
    expect(allowed).not.toHaveProperty('rateLimited');
    
    // Cleanup rate limit state
    clearUsageRateLimit(id1);
    clearUsageRateLimit(id2);
    
    // Cleanup entries
    removeEntry(id1);
    removeEntry(id2);
  });
});
