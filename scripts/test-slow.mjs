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

const vitestArgs = ['run', ...slowTests];

const child = spawn('npx', ['vitest', ...vitestArgs], { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', code => process.exit(code));
