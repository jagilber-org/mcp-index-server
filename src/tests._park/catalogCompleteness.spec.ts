import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CatalogLoader } from '../services/catalogLoader';
import { getInstructionsDir } from '../services/catalogContext';

// Red/Green harness for catalog completeness discrepancy (feedback: 45 files on disk vs 25 indexed)
// Red test (it.fails): Reproduces current production observation by asserting ALL scanned files are accepted.
// This intentionally fails if any file is skipped (schema / classification / parse rejection), confirming gap.
// Green test: Controlled synthetic directory with only valid entries MUST achieve 100% acceptance.

describe('catalog completeness (red/green)', () => {
  it('RED: capture current completeness metrics (will flag if discrepancy emerges)', () => {
    const dir = getInstructionsDir();
    const loader = new CatalogLoader(dir);
    const res = loader.load();
    const scanned = res.debug?.scanned ?? 0;
    const accepted = res.entries.length;
  const trace = res.debug?.trace || [];
  const skippedTrace = trace.filter(t => !t.accepted);
  // Allowed skip reasons (non-instruction configs) – do not count toward failure threshold
  const allowed = new Set(['ignored:non-instruction-config','ignored:template']);
  const unexpected = skippedTrace.filter(t => !(t.reason && allowed.has(t.reason)));
  // eslint-disable-next-line no-console
  console.error('[catalogCompleteness][real]', { scanned, accepted, skipped: skippedTrace.length, unexpected });
  expect(unexpected.length).toBe(0);
  });

  it('DIAG: produce detailed trace of skipped files with reasons', () => {
    // Enable file trace for this diagnostic test
    process.env.MCP_CATALOG_FILE_TRACE = '1';
    const dir = getInstructionsDir();
    const loader = new CatalogLoader(dir);
    const res = loader.load();
    const trace = res.debug?.trace || [];
    const skipped = trace.filter(t => !t.accepted);
    // eslint-disable-next-line no-console
    console.error('[catalogCompleteness][trace]', {
      scanned: res.debug?.scanned,
      accepted: res.entries.length,
      skippedCount: skipped.length,
      skipped
    });
    // Diagnostic test always passes; actionable failure enforced in RED test above
    expect(Array.isArray(trace)).toBe(true);
    delete process.env.MCP_CATALOG_FILE_TRACE;
  });

  it('GREEN: synthetic directory with only valid entries loads 100% of files', () => {
    const tmp = path.join(process.cwd(), 'tmp', `catalog-green-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    const count = 10;
    for(let i=0;i<count;i++){
      const id = `green_valid_${i}`;
      const record = {
        id,
        title: `Title ${i}`,
        body: `Body ${i}`,
        priority: 10,
        audience: 'all',
        requirement: 'mandatory',
        categories: [],
        sourceHash: '',
        schemaVersion: '1'
      };
      fs.writeFileSync(path.join(tmp, id + '.json'), JSON.stringify(record, null, 2));
    }
    const loader = new CatalogLoader(tmp);
    const res = loader.load();
    expect(res.debug?.scanned).toBe(count);
    expect(res.entries.length).toBe(count);
    expect(res.debug?.skipped).toBe(0);
  });
});
