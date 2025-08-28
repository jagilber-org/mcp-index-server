import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../schemas/instruction.schema.json';

// This suite ensures every schema property is represented across template examples
// and validates templates conform (or intentionally allow blanks) before enrichment.

describe('templates schema coverage', () => {
  const templatesDir = path.join(process.cwd(), 'instructions', '_templates');
  const templates = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
  const loaded = templates.map(f => ({ file: f, json: JSON.parse(fs.readFileSync(path.join(templatesDir,f),'utf8')) as Record<string,unknown> }));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema as Record<string, unknown>);

  it('each template either valid or only fails on allowed placeholder blanks', () => {
    const allowedBlankFields = new Set([
      'createdAt','updatedAt','lastReviewedAt','nextReviewDue','priorityTier','semanticSummary','sourceHash','changeLog/0/changedAt'
    ]);
    for(const t of loaded){
      const ok = validate(t.json);
      if(!ok){
        // Filter out errors that are only due to minLength/format on allowed blank fields
        const filtered = (validate.errors||[]).filter(e => {
          if(e.instancePath){
            const field = e.instancePath.replace(/^\//,'');
            if(allowedBlankFields.has(field)) return false; // ignore
          }
          return true;
        });
        if(filtered.length){
          throw new Error(`Template ${t.file} has disallowed validation errors: `+ JSON.stringify(filtered, null,2));
        }
      }
    }
  });

  it('schema properties are covered across templates', () => {
  const properties = Object.keys((schema as Record<string, unknown>).properties || {});
    const present = new Set<string>();
    for(const t of loaded){
      for(const k of Object.keys(t.json)) present.add(k);
    }
    const missing = properties.filter(p => !present.has(p));
    expect(missing).toEqual([]);
  });

  it('changeLog entries in full governance example meet pattern requirements', () => {
    const full = loaded.find(x => x.file === 'full_governance_example.json');
    expect(full).toBeTruthy();
  const changeLog = full?.json.changeLog as unknown as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(changeLog)).toBe(true);
    expect(changeLog && changeLog.length).toBeGreaterThan(0);
    const entry = changeLog![0];
    expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof entry.summary).toBe('string');
  });
});
