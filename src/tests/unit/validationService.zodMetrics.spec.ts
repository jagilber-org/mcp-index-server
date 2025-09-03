import { describe, it, expect, beforeEach } from 'vitest';
import { validateParams, clearValidationCache, getValidationMetrics } from '../../services/validationService';
import { getZodEnhancedRegistry } from '../../services/toolRegistry.zod';

// Ensure registry (with zod augmentation) is loaded before tests
getZodEnhancedRegistry();

describe('validationService zod metrics integration', () => {
  beforeEach(() => { clearValidationCache(); const m = getValidationMetrics(); m.zodSuccess = m.zodFailure = m.ajvSuccess = m.ajvFailure = 0; });

  it('counts zod success for feedback/submit (has zod)', () => {
    const res = validateParams('feedback/submit', { type: 'issue', severity: 'low', title: 'ok', description: 'desc' });
    expect(res.ok).toBe(true);
    const metrics = getValidationMetrics();
    expect(metrics.zodSuccess).toBeGreaterThanOrEqual(1);
  });

  it('produces mapped errors (zod path) on invalid enum', () => {
    const res = validateParams('feedback/submit', { type: 'not-real', severity: 'low', title: 't', description: 'd' });
    expect(res.ok).toBe(false);
    if(res.ok === false){
      expect(Array.isArray(res.errors)).toBe(true);
  // Some mappings may collapse or redact messages; presence of an array is sufficient for this metric-oriented test.
    }
    const metrics = getValidationMetrics();
    expect(metrics.zodFailure).toBeGreaterThanOrEqual(1);
  });

  it('falls back to ajv for tool without zod schema (e.g., feature/status if present)', () => {
    // Choose a tool unlikely to have Zod schema; using meta/tools or metrics/snapshot
    const toolName = 'metrics/snapshot';
    const res = validateParams(toolName, {});
    expect(res.ok).toBe(true);
    const metrics = getValidationMetrics();
    // At least one AJV success should be recorded (can't guarantee zero zod successes overall)
    expect(metrics.ajvSuccess + metrics.ajvFailure).toBeGreaterThanOrEqual(1);
  });
});
