import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { incrementUsage, writeEntry, removeEntry } from '../services/catalogContext';
import { enableFeature } from '../services/features';
import '../services/toolHandlers';

// Phase 1 Rate Limiting Tests
beforeAll(() => {
  process.env.INDEX_FEATURES = (process.env.INDEX_FEATURES ? (process.env.INDEX_FEATURES + ',usage') : 'usage');
  enableFeature('usage');
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
    // Clean up any existing entry
    try {
      removeEntry(testId);
    } catch { /* ignore cleanup errors */ }
    
    // Add test entry
    writeEntry(testEntry);
    
    // Clean up any existing rate limit state by waiting for window to reset
    const now = Date.now();
    const nextWindow = Math.ceil(now / 1000) * 1000;
    const waitTime = nextWindow - now + 10; // wait for next window + small buffer
    return new Promise(resolve => setTimeout(resolve, waitTime));
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
    // First 10 should succeed
    for (let i = 0; i < 10; i++) {
      const result = incrementUsage(testId);
      expect(result).toBeTruthy();
      expect(result).not.toHaveProperty('rateLimited');
    }
    
    // 11th should be rate limited
    const blockedResult = incrementUsage(testId);
    expect(blockedResult).toHaveProperty('rateLimited', true);
    expect(blockedResult).toHaveProperty('usageCount', 0);
    expect(blockedResult).toHaveProperty('id', testId);
  });

  it('resets rate limit in new time window', async () => {
    // Fill up current window
    for (let i = 0; i < 10; i++) {
      incrementUsage(testId);
    }
    
    // Next increment should be blocked
    const blocked = incrementUsage(testId);
    expect(blocked).toHaveProperty('rateLimited', true);
    
    // Wait for next 1-second window
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Should allow increments in new window
    const result = incrementUsage(testId);
    expect(result).toBeTruthy();
    expect(result).not.toHaveProperty('rateLimited');
  });

  it('tracks separate rate limits per id', () => {
    const id1 = 'rate-test-1';
    const id2 = 'rate-test-2';
    
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
    
    // Cleanup
    removeEntry(id1);
    removeEntry(id2);
  });
});
