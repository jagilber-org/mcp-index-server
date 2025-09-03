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
// Normal-verbosity tracing (level 1+) for per-file load lifecycle
import { emitTrace, traceEnabled } from './tracing';

export interface CatalogLoadResult {
  entries: InstructionEntry[];
  errors: { file: string; error: string }[];
  hash: string; // combined catalog hash
  debug?: { scanned: number; accepted: number; skipped: number; trace?: { file:string; accepted:boolean; reason?:string }[] };
}

export class CatalogLoader {
  constructor(private readonly baseDir: string, private readonly classifier = new ClassificationService()){}

  /**
   * Robust JSON file reader with retry/backoff for transient Windows / network FS issues (EPERM/EBUSY/EACCES)
   * and partial write races (empty file or truncated JSON). Ensures we rarely skip valid instructions due
   * to momentary locks while another process is atomically renaming/writing.
   */
  private readJsonWithRetry(file: string): unknown {
    const maxAttempts = Math.max(1, Number(process.env.MCP_READ_RETRIES)||3);
    const baseBackoff = Math.max(1, Number(process.env.MCP_READ_BACKOFF_MS)||8);
    let lastErr: unknown = null;
    for(let attempt=1; attempt<=maxAttempts; attempt++){
      try {
        const raw = fs.readFileSync(file,'utf8');
        // Treat empty content as transient (likely race) unless final attempt
        if(!raw.trim()){ if(attempt===maxAttempts) return {}; throw new Error('empty file transient'); }
        return JSON.parse(raw) as unknown;
      } catch(err){
        const code = (err as NodeJS.ErrnoException).code;
        const transient = code==='EPERM' || code==='EBUSY' || code==='EACCES' || code==='ENOENT' || (err instanceof Error && /transient|JSON/.test(err.message));
        if(!transient || attempt===maxAttempts){ lastErr = err; break; }
        lastErr = err;
        const sleep = baseBackoff * Math.pow(2, attempt-1) + Math.floor(Math.random()*baseBackoff);
        const start = Date.now();
        while(Date.now()-start < sleep){ /* spin tiny backoff (< few ms) */ }
      }
    }
    if(lastErr) throw lastErr instanceof Error? lastErr: new Error('readJsonWithRetry failed');
    return {}; // unreachable but satisfies typing
  }

  load(): CatalogLoadResult {
    const dir = path.resolve(this.baseDir);
    if(!fs.existsSync(dir)) return { entries: [], errors: [{ file: dir, error: 'missing directory'}], hash: '' };
  // Lightweight in-process memoization to reduce repeated parse/validate cost when ALWAYS_RELOAD is set.
  // Enabled if MCP_CATALOG_MEMOIZE=1 OR (INSTRUCTIONS_ALWAYS_RELOAD=1 and MCP_CATALOG_MEMOIZE not explicitly disabled with 0).
  // Semantics preserved: directory is still scanned each load; changed files (mtime/size) are re-read.
  // Cache key: absolute file path; validation skipped only if size + mtime unchanged.
  // NOTE: This deliberately trusts OS mtime granularity (sufficient for test/runtime reload cadence).
  const memoryCacheEnabled = (process.env.MCP_CATALOG_MEMOIZE === '1') || (process.env.INSTRUCTIONS_ALWAYS_RELOAD === '1' && process.env.MCP_CATALOG_MEMOIZE !== '0');
  const hashMemoEnabled = process.env.MCP_CATALOG_MEMOIZE_HASH === '1';
  type CacheEntry = { mtimeMs: number; size: number; entry: InstructionEntry; contentHash?: string; buildSig: string };
  const buildSig = `schema:${SCHEMA_VERSION}`; // extend with classifier / normalization version if those become versioned
  // Module-level singleton map (attached to globalThis to survive module reloads in test environments without duplicating state)
  const globalAny = globalThis as unknown as { __MCP_CATALOG_MEMO?: Map<string, CacheEntry> };
  if(!globalAny.__MCP_CATALOG_MEMO){ globalAny.__MCP_CATALOG_MEMO = new Map(); }
  const catalogMemo = globalAny.__MCP_CATALOG_MEMO as Map<string, CacheEntry>;
  let cacheHits = 0;
  let hashHits = 0;
  const ajv = new Ajv({ allErrors: true, strict: false });
  // Add standard date-time, uri, etc. formats
  addFormats(ajv);
  // Register draft-07 meta schema under https id (with and without trailing #) if not present.
  // Some schema files include $schema value with trailing '#', so we defensively register both forms.
  try {
    const httpsIdNoHash = 'https://json-schema.org/draft-07/schema';
    const httpsIdHash = 'https://json-schema.org/draft-07/schema#';
    if(!ajv.getSchema(httpsIdNoHash)){
      ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdNoHash });
    }
    if(!ajv.getSchema(httpsIdHash)){
      // Provide alias with trailing # (clone to avoid mutating previously added object)
      ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdHash });
    }
  } catch { /* ignore meta-schema registration issues */ }
  const validate = ajv.compile(schema as unknown as object) as (data: unknown) => boolean;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const entries: InstructionEntry[] = [];
  const errors: { file: string; error: string }[] = [];
  // File-level trace (opt-in) surfaces every scanned file decision so higher-level diagnostics
  // can correlate missingOnCatalog IDs with explicit acceptance / rejection reasons. Enable by
  // setting MCP_CATALOG_FILE_TRACE=1 together with MCP_TRACE_ALL for broader context.
  const fileTraceEnabled = process.env.MCP_CATALOG_FILE_TRACE === '1';
  const trace: { file:string; accepted:boolean; reason?:string }[] | undefined = fileTraceEnabled ? [] : undefined;
  // New lightweight always-available (level>=1) sequential tracing with cumulative counters.
  let scannedSoFar = 0;
  let acceptedSoFar = 0;
  for(const f of files){
      scannedSoFar++;
      if(traceEnabled(1)){
        try { emitTrace('[trace:catalog:file-begin]', { file: f, index: scannedSoFar - 1, total: files.length }); } catch { /* ignore */ }
      }
  const full = path.join(dir, f);
      // Attempt cache reuse before any I/O beyond stat
      let reused = false;
    if(memoryCacheEnabled){
        try {
          const st = fs.statSync(full);
          const cached = catalogMemo.get(full);
      if(cached && cached.size === st.size && Math.abs(cached.mtimeMs - st.mtimeMs) < 1 && cached.buildSig === buildSig){
            // Reuse cached normalized entry
            entries.push({ ...cached.entry });
            acceptedSoFar++;
            cacheHits++;
            reused = true;
            if(trace) trace.push({ file:f, accepted:true, reason:'cache-hit' });
            if(traceEnabled(1)){
              try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: true, cached: true, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
              try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
            }
          }
        } catch { /* stat or reuse failure falls through to normal path */ }
      }
      if(reused) continue;
      // Exclude any files within a _templates directory (non-runtime placeholders)
      if(full.includes(`${path.sep}_templates${path.sep}`)){
        if(trace) trace.push({ file:f, accepted:false, reason:'ignored:template' });
        if(traceEnabled(1)){
          try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason: 'ignored:template', scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
          try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
        }
        continue;
      }
      try {
        // Hash-based reuse path (only if metadata changed but content identical). We compute hash before parsing.
        if(memoryCacheEnabled && hashMemoEnabled){
          try {
            const rawBuf = fs.readFileSync(full);
            const contentHash = crypto.createHash('sha256').update(rawBuf).digest('hex');
            const cached = catalogMemo.get(full);
            if(cached && cached.contentHash === contentHash && cached.buildSig === buildSig){
              // Accept from hash cache without reparsing / revalidation
              entries.push({ ...cached.entry });
              acceptedSoFar++;
              hashHits++;
              if(trace) trace.push({ file:f, accepted:true, reason:'hash-cache-hit' });
              if(traceEnabled(1)){
                try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: true, cached: true, hash: true, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
                try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
              }
              continue; // proceed next file
            }
          } catch { /* fall through to normal parse */ }
        }
  const rawAny = this.readJsonWithRetry(full) as Record<string, unknown>;
        // Ignore clearly non-instruction config files (no id/title/body/requirement) e.g. gates.json
        const looksInstruction = typeof rawAny.id === 'string' && typeof rawAny.title === 'string' && typeof rawAny.body === 'string';
        if(!looksInstruction){
          if(trace) trace.push({ file:f, accepted:false, reason:'ignored:non-instruction-config' });
          if(traceEnabled(1)){
            try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason: 'ignored:non-instruction-config', scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
            try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
          }
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
          try { fs.writeFileSync(full, JSON.stringify(raw, null, 2)); } catch { /* ignore rewrite failure */ }
        }
        
  const mutRaw = raw as InstructionEntry;
  // Derive minimal required fields for backward compatibility (new relaxed schema allows missing governance fields)
  const nowIso = new Date().toISOString();
  if(typeof mutRaw.sourceHash !== 'string' || !mutRaw.sourceHash.length){ try { mutRaw.sourceHash = crypto.createHash('sha256').update(mutRaw.body||'', 'utf8').digest('hex'); } catch { /* ignore */ } }
  if(typeof mutRaw.createdAt !== 'string' || !mutRaw.createdAt.length) mutRaw.createdAt = nowIso;
  if(typeof mutRaw.updatedAt !== 'string' || !mutRaw.updatedAt.length) mutRaw.updatedAt = nowIso;
  // Normalize legacy / pre-spec governance variants BEFORE schema validation
  // Type guard: raw.status may contain legacy value 'active'; treat as alias for 'approved'
  if((raw as unknown as { status?: string }).status === 'active'){ (raw as unknown as { status?: string }).status = 'approved'; }
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
          if(traceEnabled(1)){
            try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
            try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
          }
          continue;
        }
  const issues = this.classifier.validate(mutRaw);
        if(issues.length){
          const reason = issues.join(', ');
          errors.push({ file: f, error: reason });
          if(trace) trace.push({ file:f, accepted:false, reason });
          if(traceEnabled(1)){
            try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
            try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
          }
          continue;
        }
        const normalized = this.classifier.normalize(mutRaw);
        entries.push(normalized);
        acceptedSoFar++;
        // Populate / refresh cache after successful normalization
        if(memoryCacheEnabled){
          try {
            const st = fs.statSync(full);
            let contentHash: string | undefined;
            if(hashMemoEnabled){
              try { contentHash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'); } catch { /* ignore */ }
            }
            catalogMemo.set(full, { mtimeMs: st.mtimeMs, size: st.size, entry: { ...normalized }, contentHash, buildSig });
          } catch { /* ignore */ }
        }
        if(trace) trace.push({ file:f, accepted:true });
        if(traceEnabled(1)){
          try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: true, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
          try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
        }
      } catch(e: unknown){
        const reason = e instanceof Error ? e.message : 'unknown error';
        errors.push({ file: f, error: reason });
        if(trace) trace.push({ file:f, accepted:false, reason });
        if(traceEnabled(1)){
          try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
          try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
        }
      }
    }
    const hash = this.computeCatalogHash(entries);
    if(memoryCacheEnabled && (cacheHits || hashHits) && traceEnabled(1)){
      try { emitTrace('[trace:catalog:cache-summary]', { hits: cacheHits, hashHits, scanned: files.length, percent: Number(((cacheHits+hashHits) / files.length * 100).toFixed(2)) }); } catch { /* ignore */ }
    }
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