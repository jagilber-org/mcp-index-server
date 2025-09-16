import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CatalogLoader } from '../../services/catalogLoader';
import { ClassificationService } from '../../services/classificationService';

function writeJson(p: string, obj: any){ fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); }

const BASE = path.join(process.cwd(), 'tmp', 'unit-catalog');
const DIR = path.join(BASE, 'instructions');

function minimal(id: string){
  return { id, title: id, body: 'body '+id, priority: 10, audience: 'individual', requirement: 'mandatory', categories: [] };
}

describe('CatalogLoader (unit)', () => {
  beforeEach(() => {
    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    delete (globalThis as any).__MCP_CATALOG_MEMO; // reset memo cache between tests
  });

  it('loads single valid instruction and computes stable hash', () => {
    writeJson(path.join(DIR, 'a.json'), minimal('a'));
    const loader = new CatalogLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.entries.length).toBe(1);
    expect(res.errors).toHaveLength(0);
    expect(res.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('skips non-instruction config and reports no error', () => {
    writeJson(path.join(DIR, 'gates.json'), { some: 'config' });
    const loader = new CatalogLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.entries.length).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it('normalizes previously schema-invalid id (bad casing/spaces) instead of rejecting', () => {
    writeJson(path.join(DIR, 'bad.json'), { ...minimal('Bad Upper'), id: 'Bad Upper' });
    const loader = new CatalogLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.errors.length).toBe(0);
    expect(res.entries.length).toBe(1);
    // Expect sanitized id: lower-case, spaces -> hyphens, trimmed
    expect(res.entries[0].id).toBe('bad-upper');
  });

  it('memoizes unchanged file when MCP_CATALOG_MEMOIZE=1', () => {
    process.env.MCP_CATALOG_MEMOIZE = '1';
    writeJson(path.join(DIR, 'a.json'), minimal('a'));
    const loader1 = new CatalogLoader(DIR, new ClassificationService());
    const res1 = loader1.load();
    // touch: load again; second load should report same entry count and zero errors
    const loader2 = new CatalogLoader(DIR, new ClassificationService());
    const res2 = loader2.load();
    expect(res1.entries[0].id).toBe('a');
    expect(res2.entries[0].id).toBe('a');
    delete process.env.MCP_CATALOG_MEMOIZE;
  });
});
