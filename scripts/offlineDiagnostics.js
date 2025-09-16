#!/usr/bin/env node
// Offline diagnostics runner: explicitly points to devinstructions (prod snapshot) and prints diagnostics.
// Ensures we do NOT accidentally scan the much larger default instructions/ directory.
const path = require('path');
// Force the intended directory BEFORE requiring catalogContext so it pins correctly.
process.env.INSTRUCTIONS_DIR = path.resolve(__dirname, '../devinstructions');
process.env.INSTRUCTIONS_ALWAYS_RELOAD = '1';
process.env.MCP_CATALOG_FILE_TRACE = '1';
process.env.MCP_VISIBILITY_DIAG = '1';

const { getCatalogDiagnostics } = require('../dist/services/catalogContext.js');

(async () => {
  try {
    const diag = getCatalogDiagnostics({ includeTrace: true });
    const out = { ...diag, traceSampleCount: diag.traceSample ? diag.traceSample.length : 0 };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('FAILED_OFFLINE_DIAGNOSTICS', e);
    process.exit(1);
  }
})();
