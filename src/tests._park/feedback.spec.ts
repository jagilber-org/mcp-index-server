import { describe, it, expect } from 'vitest';

// Legacy feedback test entry point
// Real tests now live in:
//   - feedbackCore.spec.ts (comprehensive)
//   - feedbackSimple.spec.ts (basic smoke)
// This file remains so historical references / tooling pointing at feedback.spec.ts still resolve.
// Do NOT add functional tests here; keep redirection minimal.

describe('feedback legacy placeholder', () => {
	it('redirects to dedicated feedback test suites', () => {
		expect(true).toBe(true);
	});
});
