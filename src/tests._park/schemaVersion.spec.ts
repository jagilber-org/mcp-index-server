import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import { CatalogLoader } from '../services/catalogLoader';

describe('schema version consistency', () => {
  it('all loaded instructions reflect current SCHEMA_VERSION', () => {
    const dir = path.join(process.cwd(),'instructions');
    if(!fs.existsSync(dir)) return; // nothing to check in pristine repo
    const loader = new CatalogLoader(dir);
    const loaded = loader.load().entries;
    for(const e of loaded){
      expect(e.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });
});
