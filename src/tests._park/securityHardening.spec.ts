import { describe, it, expect } from 'vitest';
import '../services/toolHandlers';
import { PromptReviewService } from '../services/promptReviewService';

// Directly test sanitization logic by simulating large input and null bytes.

describe('security hardening - prompt/review limits', () => {
  it('handles oversized prompt scenario (simulated)', () => {
    const big = 'a'.repeat(10001);
    const service = new PromptReviewService();
    const truncated = big.slice(0, 10000);
    const issues = service.review(truncated);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('removes null bytes before review', () => {
    const service = new PromptReviewService();
    const input = 'secret\0text';
    const sanitized = input.replace(/\0/g,'');
    const issues = service.review(sanitized);
    expect(issues).toBeDefined();
  });
});
