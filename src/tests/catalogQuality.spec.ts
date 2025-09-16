import { describe, it, expect } from 'vitest';
import { CatalogLoader } from '../services/catalogLoader';
import path from 'path';

// These tests assert catalog acceptance quality gates so future changes do not
// silently reintroduce large schema rejection buckets for enum drift.

describe('Catalog Quality Gates', () => {
  const dir = process.env.INSTRUCTIONS_DIR || path.join(process.cwd(),'devinstructions');
  const loader = new CatalogLoader(dir);
  const result = loader.load();
  const summary = result.summary!;

  it('scanned math reconciles', () => {
    expect(summary.scanned).toBe(summary.accepted + summary.skipped);
  });

  it('no audience/requirement schema skips remain (salvaged instead)', () => {
    // schema bucket should not include audience/requirement enum errors now
    const audienceEnumErr = Object.keys(result.errors).some(e => /audience: must be equal/.test(e));
    const requirementEnumErr = Object.keys(result.errors).some(e => /requirement: must be equal/.test(e));
    expect(audienceEnumErr).toBe(false);
    expect(requirementEnumErr).toBe(false);
  });

  it('salvage counters recorded for invalid enums when present', () => {
    const salvage = summary.salvage || {}; // keys like audienceInvalid, requirementInvalid
    // Not strictly required they appear every run, but if there were invalid inputs we should see counts.
    // This assertion is defensive: if there WERE schema enum skips previously they should now be salvage counts.
    const hadInvalidsPreviously = (summary.reasons['schema']||0) > 0; // baseline schema errors existed
    if(hadInvalidsPreviously){
      // At least one salvage key should appear for invalid mapping categories we added.
      const salvageKeys = Object.keys(salvage);
      expect(salvageKeys.some(k => /(audienceInvalid|requirementInvalid)/.test(k))).toBe(true);
    }
  });

  it('body truncation salvage does not exceed hard limit', () => {
    const oversized = result.entries.filter(e => e.body.length > 20000);
    expect(oversized.length).toBe(0);
  });
});
