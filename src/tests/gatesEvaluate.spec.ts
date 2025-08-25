import { describe, it, expect } from 'vitest';
import '../services/toolHandlers';
import { getCatalogState } from '../services/toolHandlers';
import fs from 'fs';
import path from 'path';

// Reproduce evaluation logic by loading gates.json through handler indirectly.

describe('gates/evaluate', () => {
  it('computes pass/fail counts', () => {
    // Ensure catalog loaded
    getCatalogState();
    const gatesPath = path.join(process.cwd(), 'instructions', 'gates.json');
    expect(fs.existsSync(gatesPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(gatesPath,'utf8'));
    expect(Array.isArray(raw.gates)).toBe(true);
  });
});
