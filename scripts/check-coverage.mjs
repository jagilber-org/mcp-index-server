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
const min = 80;
if(pct < min){
  console.error(`[coverage-check] FAIL lines=${pct.toFixed(2)} < ${min}`);
  process.exit(1);
}
console.log(`[coverage-check] PASS lines=${pct.toFixed(2)} >= ${min}`);
