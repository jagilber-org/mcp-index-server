#!/usr/bin/env node
/**
 * Baseline Guard
 * Fails if repository deviates from authoritative baseline control file expectations:
 *  - INTERNAL-BASELINE.md must exist
 *  - Execution Log section present
 *  - Minimal invariant suite scripts/tests present
 *  - No unexpected test proliferation when BASELINE_ENFORCE=1
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { exit } from 'process';

const errors = [];
const baselineFile = 'INTERNAL-BASELINE.md';
if (!existsSync(baselineFile)) {
  errors.push('Missing INTERNAL-BASELINE.md');
} else {
  const content = readFileSync(baselineFile, 'utf8');
  if (!/## 15\. Execution Log/.test(content)) {
    errors.push('Baseline file missing Execution Log section');
  }
  if (!/## 3\. Success Criteria/.test(content)) {
    errors.push('Baseline file missing Success Criteria section');
  }
}

// Minimal suite expectations
const minimalTests = [
  'createReadSmoke.spec.ts',
  'portableCrudAtomic.spec.ts',
  'instructionsAddPersistence.spec.ts',
  // Imperative directive safeguard: ensures debug/diag env flags remain disabled unless formally approved
  'mcpConfigImperativeDirective.spec.ts'
];

let testDirFiles = [];
try { testDirFiles = readdirSync('src/tests'); } catch {}

for (const mt of minimalTests) {
  if (!testDirFiles.includes(mt)) {
    errors.push(`Missing minimal test: ${mt}`);
  }
}

// Enforce no unexpected test expansion when BASELINE_ENFORCE=1
if (process.env.BASELINE_ENFORCE === '1') {
  const allowed = new Set([...minimalTests]);
  const phase = process.env.BASELINE_PHASE || '';
  const extra = testDirFiles.filter(f => /\.spec\.ts$/.test(f) && !allowed.has(f));
  if (extra.length && phase !== 'pre-isolation') {
    errors.push('Unexpected test files present under BASELINE_ENFORCE=1: ' + extra.join(', '));
  }
  // Sentinel verification
  try {
    if (existsSync('.baseline.sentinel') && existsSync(baselineFile)) {
      const sentinel = readFileSync('.baseline.sentinel', 'utf8').trim();
      const current = createHash('sha256').update(readFileSync(baselineFile,'utf8'),'utf8').digest('hex');
      if (sentinel !== current) {
        errors.push('Baseline sentinel mismatch. Expected ' + sentinel + ' current ' + current);
      }
    } else {
      errors.push('Missing sentinel file .baseline.sentinel under enforcement');
    }
  } catch (e) {
    errors.push('Sentinel verification error: ' + (e && e.message || e));
  }
}

if (errors.length) {
  console.error('\nBaseline guard violations:');
  for (const e of errors) console.error(' - ' + e);
  console.error('\nResolve deviations or update INTERNAL-BASELINE.md via formal CHANGE REQUEST.');
  exit(1);
}
console.log('Baseline guard: OK');
