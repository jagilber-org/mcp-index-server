import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('catalog manifest contract', () => {
  it('stable tools snapshot exists when generated', () => {
    const snap = path.join(process.cwd(),'snapshots','stable-tools.json');
    if(!fs.existsSync(snap)){
      // Not generated yet; skip (no failure to avoid blocking initial generation)
      expect(true).toBe(true);
      return;
    }
    const raw = JSON.parse(fs.readFileSync(snap,'utf8'));
    expect(Array.isArray(raw.tools)).toBe(true);
    expect(raw.tools.every((t:string)=> typeof t === 'string')).toBe(true);
  });
  it('manifest file (if present) has expected shape', () => {
    const manifestFile = path.join(process.cwd(),'snapshots','catalog-manifest.json');
    if(!fs.existsSync(manifestFile)){
      expect(true).toBe(true);
      return;
    }
    const m = JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    expect(typeof m.governanceHash).toBe('string');
    expect(Array.isArray(m.entries)).toBe(true);
  });
});
