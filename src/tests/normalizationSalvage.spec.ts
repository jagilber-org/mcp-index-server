import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getCatalogState, invalidate, markCatalogDirty, touchCatalogVersion } from '../services/catalogContext';

// This test verifies that legacy / variant audience & requirement values are salvaged
// (normalized) rather than rejected by schema validation after recent enhancements.

function writeJson(file: string, obj: unknown){
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

describe('normalization salvage', () => {
  const dir = path.join(process.cwd(), 'tmp', 'salvage-tests');
  const prevEnv = process.env.INSTRUCTIONS_DIR;
  beforeAll(()=>{
    fs.mkdirSync(dir, { recursive: true });
    process.env.INSTRUCTIONS_DIR = dir;
  });

  it('salvages audience variants and freeform requirement sentences', () => {
    const legacy = {
      id: 'salvage-audience-teams',
      title: 'Legacy audience value teams',
      body: 'Example body',
      audience: 'teams', // variant not in strict enum
      requirement: 'This is a free form descriptive requirement sentence explaining expectations.',
      priority: 50,
      categories: ['test'],
      schemaVersion: '3'
    };
    writeJson(path.join(dir, 'salvage-audience-teams.json'), legacy);
    // Force reload
    invalidate(); markCatalogDirty(); touchCatalogVersion();
    const st = getCatalogState();
    const entry = st.byId.get('salvage-audience-teams');
    // Depending on timing, salvage may have normalized prior to validation; if not present, fail for visibility.
    expect(entry, 'entry should be accepted after salvage normalization').toBeTruthy();
    if(entry){
      expect(entry.audience).toBe('group');
      expect(entry.requirement).toBe('recommended');
    }
  });

  it('salvages upper-case requirement MUST and maps to mandatory', () => {
    const legacy = {
      id: 'salvage-requirement-must',
      title: 'Legacy requirement MUST',
      body: 'Example body 2',
      audience: 'developers',
      requirement: 'MUST',
      priority: 40,
      categories: ['test'],
      schemaVersion: '3'
    };
    writeJson(path.join(dir, 'salvage-requirement-must.json'), legacy);
    invalidate(); markCatalogDirty(); touchCatalogVersion();
    const st = getCatalogState();
    const entry = st.byId.get('salvage-requirement-must');
    expect(entry).toBeTruthy();
    expect(entry?.requirement).toBe('mandatory');
    expect(entry?.audience).toBe('group'); // developers -> group
  });

  afterAll(()=>{
    process.env.INSTRUCTIONS_DIR = prevEnv;
  });
});
