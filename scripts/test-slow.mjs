#!/usr/bin/env node
/**
 * Executes the designated "slow / pre-push" test suites.
 * These are correctness / regression detection suites that are
 * intentionally heavier (multi‑client coordination, large sampling,
 * persistence divergence reproduction, or performance exploration).
 *
 * Usage: node scripts/test-slow.mjs
 *   (internally spawns vitest with explicit file list)
 *
 * Customize by editing the slowTests array below. Keep list small
 * and focused on high-signal scenarios that are safe to run locally
 * before pushing but not needed on every build:verify cycle.
 */
import { spawn } from 'child_process';
import { slowTests } from './slow-tests.mjs';

// Quarantine support: known unstable / flaky cases temporarily excluded from default run.
// Run with INCLUDE_UNSTABLE_SLOW=1 to execute full set while stabilizing.
const unstable = [
	'src/tests/feedbackReproduction.multiClient.spec.ts',
	'src/tests/governanceHashIntegrity.spec.ts',
	// Additional high‑variance or timing sensitive specs (expand as needed)
	'src/tests/instructionsPersistenceDivergence.red.spec.ts'
];

const selected = slowTests.filter(t => !unstable.includes(t) || process.env.INCLUDE_UNSTABLE_SLOW === '1');
if (!selected.length) {
	console.warn('[test-slow] No slow tests selected (all quarantined?). Set INCLUDE_UNSTABLE_SLOW=1 to force run.');
}
if (process.env.INCLUDE_UNSTABLE_SLOW === '1' && unstable.length) {
	console.log('[test-slow] INCLUDE_UNSTABLE_SLOW=1 => running unstable set:', unstable);
} else if (unstable.length) {
	const skipped = unstable.filter(u => slowTests.includes(u));
	if (skipped.length) console.log('[test-slow] Quarantined (skipped) unstable tests:', skipped);
}
const vitestArgs = ['run', ...selected];

const child = spawn('npx', ['vitest', ...vitestArgs], { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', code => process.exit(code));
