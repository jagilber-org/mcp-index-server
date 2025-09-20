#!/usr/bin/env node
/* eslint-disable */
// Simple low-water coverage gate (lines >=80%)
import fs from 'fs';

const reportPath = 'coverage/coverage-final.json';
if(!fs.existsSync(reportPath)){
  console.error('[coverage-check] coverage-final.json missing; skipping gate');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(reportPath,'utf8'));
let total = { lines:{ covered:0, pct:0, total:0 } };
// Istanbul JSON: each file has statementMap, s (counts), branchMap, b (counts) etc.
// We'll compute lines from statement counts as approximation (already used by report).
let covered=0, totalLines=0;
for(const file of Object.keys(data)){
  const f = data[file];
  if(!f || !f.statementMap) continue;
  const sCounts = f.s || {};
  for(const key of Object.keys(sCounts)){
    totalLines++;
    if(sCounts[key] > 0) covered++;
  }
}
const pct = totalLines? (covered/totalLines)*100: 0;
// Support dual gate via env:
// COVERAGE_HARD_MIN: failing threshold (default 80)
// COVERAGE_TARGET: advisory target (logs warning if not met)
const hardMin = Number(process.env.COVERAGE_HARD_MIN || 80);
const target = Number(process.env.COVERAGE_TARGET || hardMin);
if(pct < hardMin){
  console.error(`[coverage-check] FAIL lines=${pct.toFixed(2)} < hardMin=${hardMin}`);
  process.exit(1);
}
if(pct < target){
  console.warn(`[coverage-check] WARN lines=${pct.toFixed(2)} < target=${target} (>= hardMin=${hardMin})`);
  process.exitCode = 0;
} else {
  console.log(`[coverage-check] PASS lines=${pct.toFixed(2)} >= target=${target}`);
}
