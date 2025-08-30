import { describe, it, expect } from 'vitest';
import { validateParams, clearValidationCache } from '../services/validationService';

describe('validationService', () => {
  it('passes validation for a valid instructions/add payload', () => {
    clearValidationCache();
    const ok = validateParams('instructions/add', { entry: { id: 'x', body: 'test' } });
    expect(ok).toEqual({ ok: true });
  });
});
