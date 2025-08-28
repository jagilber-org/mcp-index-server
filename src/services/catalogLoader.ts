import { InstructionEntry } from '../models/instruction';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ClassificationService } from './classificationService';
import { SCHEMA_VERSION, migrateInstructionRecord } from '../versioning/schemaVersion';
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
  debug?: { scanned: number; accepted: number; skipped: number; trace?: { file:string; accepted:boolean; reason?:string }[] };
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
  const traceEnabled = process.env.MCP_CATALOG_FILE_TRACE === '1';
  const trace: { file:string; accepted:boolean; reason?:string }[] | undefined = traceEnabled ? [] : undefined;
  for(const f of files){
      const full = path.join(dir, f);
      try {
        const rawAny = JSON.parse(fs.readFileSync(full,'utf8')) as Record<string, unknown>;
        // Ignore clearly non-instruction config files (no id/title/body/requirement) e.g. gates.json
        const looksInstruction = typeof rawAny.id === 'string' && typeof rawAny.title === 'string' && typeof rawAny.body === 'string';
        if(!looksInstruction){
          if(trace) trace.push({ file:f, accepted:false, reason:'ignored:non-instruction-config' });
          continue;
        }
        // Clone to typed object after basic shape check
  const raw = rawAny as unknown as InstructionEntry; // validated progressively below
        
        // Check schema version and migrate if needed
        let needsRewrite = false;
        if(!raw.schemaVersion || raw.schemaVersion !== SCHEMA_VERSION){
          const mig = migrateInstructionRecord(raw as unknown as Record<string, unknown>);
          if(mig.changed) {
            needsRewrite = true;
          }
        }
        
        if(needsRewrite){
          fs.writeFileSync(full, JSON.stringify(raw, null, 2));
        }
        
  const mutRaw = raw as InstructionEntry;
  // Derive minimal required fields for backward compatibility (new relaxed schema allows missing governance fields)
  const nowIso = new Date().toISOString();
  if(typeof mutRaw.sourceHash !== 'string' || !mutRaw.sourceHash.length){ try { mutRaw.sourceHash = crypto.createHash('sha256').update(mutRaw.body||'', 'utf8').digest('hex'); } catch { /* ignore */ } }
  if(typeof mutRaw.createdAt !== 'string' || !mutRaw.createdAt.length) mutRaw.createdAt = nowIso;
  if(typeof mutRaw.updatedAt !== 'string' || !mutRaw.updatedAt.length) mutRaw.updatedAt = nowIso;
        // Preprocess placeholder governance fields: convert empty strings to undefined so schema doesn't reject
        const placeholderKeys: (keyof InstructionEntry)[] = ['createdAt','updatedAt','lastReviewedAt','nextReviewDue','priorityTier','semanticSummary'];
        for(const k of placeholderKeys){
          const v = (mutRaw as unknown as Record<string, unknown>)[k];
          if(v === ''){ delete (mutRaw as unknown as Record<string, unknown>)[k]; }
        }
        if(!validate(mutRaw)){
          const reason = 'schema: ' + ajv.errorsText();
          errors.push({ file: f, error: reason });
          if(trace) trace.push({ file:f, accepted:false, reason });
          continue;
        }
  const issues = this.classifier.validate(mutRaw);
        if(issues.length){
          const reason = issues.join(', ');
          errors.push({ file: f, error: reason });
          if(trace) trace.push({ file:f, accepted:false, reason });
          continue;
        }
        const normalized = this.classifier.normalize(mutRaw);
        entries.push(normalized);
        if(trace) trace.push({ file:f, accepted:true });
      } catch(e: unknown){
        const reason = e instanceof Error ? e.message : 'unknown error';
        errors.push({ file: f, error: reason });
        if(trace) trace.push({ file:f, accepted:false, reason });
      }
    }
    const hash = this.computeCatalogHash(entries);
    return { entries, errors, hash, debug: { scanned: files.length, accepted: entries.length, skipped: files.length - entries.length, trace } };
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