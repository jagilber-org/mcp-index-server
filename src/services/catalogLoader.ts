import { InstructionEntry } from '../models/instruction';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ClassificationService } from './classificationService';
import Ajv from 'ajv';
// Ajv v8 needs explicit format support when strict mode or newer setups; add common formats
import addFormats from 'ajv-formats';
// Ensure https draft-07 meta-schema is recognized when $schema uses TLS URL
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import schema from '../../schemas/instruction.schema.json';

export interface CatalogLoadResult {
  entries: InstructionEntry[];
  errors: { file: string; error: string }[];
  hash: string; // combined catalog hash
}

export class CatalogLoader {
  constructor(private readonly baseDir: string, private readonly classifier = new ClassificationService()){}

  load(): CatalogLoadResult {
    const dir = path.resolve(this.baseDir);
    if(!fs.existsSync(dir)) return { entries: [], errors: [{ file: dir, error: 'missing directory'}], hash: '' };
  const ajv = new Ajv({ allErrors: true, strict: false });
  // Add standard date-time, uri, etc. formats
  addFormats(ajv);
  // Register draft-07 meta schema under https id if not present
  try {
    if(!ajv.getSchema('https://json-schema.org/draft-07/schema')){
      ajv.addMetaSchema(draft7MetaSchema, 'https://json-schema.org/draft-07/schema');
    }
  } catch { /* ignore */ }
  const validate = ajv.compile(schema as unknown as object) as (data: unknown) => boolean;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const entries: InstructionEntry[] = [];
    const errors: { file: string; error: string }[] = [];
    for(const f of files){
      const full = path.join(dir, f);
      try {
        const raw = JSON.parse(fs.readFileSync(full,'utf8')) as InstructionEntry;
  const mutRaw = raw as InstructionEntry;
  // Derive minimal required fields for backward compatibility (new relaxed schema allows missing governance fields)
  const nowIso = new Date().toISOString();
  if(typeof mutRaw.sourceHash !== 'string' || !mutRaw.sourceHash.length){ try { mutRaw.sourceHash = crypto.createHash('sha256').update(mutRaw.body||'', 'utf8').digest('hex'); } catch { /* ignore */ } }
  if(typeof mutRaw.createdAt !== 'string' || !mutRaw.createdAt.length) mutRaw.createdAt = nowIso;
  if(typeof mutRaw.updatedAt !== 'string' || !mutRaw.updatedAt.length) mutRaw.updatedAt = nowIso;
  if(!validate(mutRaw)){
          errors.push({ file: f, error: 'schema: ' + ajv.errorsText() });
          continue;
        }
        const issues = this.classifier.validate(mutRaw);
        if(issues.length){
          errors.push({ file: f, error: issues.join(', ') });
          continue;
        }
        entries.push(this.classifier.normalize(mutRaw));
      } catch(e: unknown){
        errors.push({ file: f, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    const hash = this.computeCatalogHash(entries);
    return { entries, errors, hash };
  }

  private computeCatalogHash(entries: InstructionEntry[]): string {
    const h = crypto.createHash('sha256');
    const stable = entries
      .slice()
      .sort((a,b)=> a.id.localeCompare(b.id))
      .map(e => `${e.id}:${e.sourceHash}`)
      .join('|');
    h.update(stable,'utf8');
    return h.digest('hex');
  }
}