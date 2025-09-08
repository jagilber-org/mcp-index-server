#!/usr/bin/env node
/**
 * generate-drift-report.mjs
 * Aggregates Playwright test results + snapshot artifacts into a lightweight JSON & markdown report.
 * Intended to run post `playwright test` (CI workflow step) to create:
 *   - drift-report.json (machine readable summary)
 *   - drift-report.md   (human readable summary)
 * Both emitted to ./playwright-report/ if it exists, else project root.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPORT_DIR = fs.existsSync('playwright-report') ? 'playwright-report' : '.';
const JSON_OUT = path.join(REPORT_DIR, 'drift-report.json');
const MD_OUT = path.join(REPORT_DIR, 'drift-report.md');

function findSnapshotFiles(baseDir='tests/playwright') {
  const out = [];
  function walk(p) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full); else if (/\.png$/i.test(e.name) && /baseline\.spec\.ts-snapshots/.test(full)) out.push(full);
    }
  }
  if (fs.existsSync(baseDir)) walk(baseDir);
  return out.sort();
}

// Parse annotations from Playwright HTML JSON metadata if available
function extractAnnotations() {
  const metaFile = path.join('playwright-report', 'data', 'test.json');
  const perf = [];
  try {
    if (fs.existsSync(metaFile)) {
      const raw = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      for (const suite of raw.suites || []) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            for (const r of test.results || []) {
              for (const a of r.annotations || []) {
                if (a.type === 'perf' && /screenshot-ms=/.test(a.description)) perf.push({ spec: spec.title, annotation: a.description });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // ignore non-fatal
  }
  return perf;
}

const snapshots = findSnapshotFiles();
const perfAnn = extractAnnotations();

const report = {
  generatedAt: new Date().toISOString(),
  browsers: process.env.DRIFT_BROWSERS || 'chromium,firefox,webkit',
  maxDiffPixelRatio: process.env.DRIFT_MAX_DIFF_RATIO,
  maxDiffPixels: process.env.DRIFT_MAX_DIFF_PIXELS,
  snapshotCount: snapshots.length,
  snapshots,
  performance: perfAnn
};

fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

const md = [
  '# UI Drift Report',
  '',
  `Generated: ${report.generatedAt}`,
  `Browsers: ${report.browsers}`,
  `Thresholds: ratio=${report.maxDiffPixelRatio} pixels=${report.maxDiffPixels}`,
  '',
  '## Snapshots',
  ...report.snapshots.map(s => `- ${s}`),
  '',
  '## Performance Annotations',
  ...(report.performance.length ? report.performance.map(p => `- ${p.spec}: ${p.annotation}`) : ['(none)'])
].join('\n');

fs.writeFileSync(MD_OUT, md + '\n');
console.log(`[drift-report] Wrote ${JSON_OUT} & ${MD_OUT}`);