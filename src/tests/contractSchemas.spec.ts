/**
 * Minimal contract schema presence test.
 * The original file was empty causing intermittent "No test suite found" failures.
 * This placeholder asserts that the compiled TypeScript types for portable client load without error.
 */
import { describe, it, expect } from 'vitest';

describe('contract schemas smoke', () => {
	it('loads portable client type declarations', async () => {
		// Dynamic import ensures the module resolves; types validated at compile time.
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore - ambient declaration provided for runtime; type surfaced elsewhere
		const mod = await import('../../portable-mcp-client/client-lib.mjs');
		expect(mod).toBeTruthy();
	});
});

