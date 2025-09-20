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
  summary?: CatalogLoadSummary;
}

// Granular reason buckets for deterministic discrepancy analysis. Reason keys are
// stable API surface; DO NOT rename without backward compatibility shim.
export interface CatalogLoadSummary {
  scanned: number;
  accepted: number;
  skipped: number;
  reasons: Record<string, number>; // e.g. { 'ignored:non-instruction-config': 5, 'schema': 2 }
  cacheHits?: number;
  hashHits?: number;
  salvage?: Record<string, number>; // counts of salvaged legacy enum / fields (e.g. audience, requirement)
  softWarnings?: Record<string, number>; // non-fatal issues (e.g. near-size-limit)
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
    const loadStart = Date.now();
    if(traceEnabled(1)){
      try { emitTrace('[trace:catalog:load-begin]', { dir }); } catch { /* ignore */ }
    }
    if(!fs.existsSync(dir)) return { entries: [], errors: [{ file: dir, error: 'missing directory'}], hash: '' };
    // Normalization audit logging (optional): if MCP_CATALOG_NORMALIZATION_LOG is set, we
    // capture per-file normalization deltas (only when a rewrite-worthy change occurs) and
    // emit them as JSONL at the end of the load cycle. This creates a lightweight, append-
    // only forensic trail for production migrations without impacting the hot path when
    // disabled.
    const normLogEnv = process.env.MCP_CATALOG_NORMALIZATION_LOG; // '1' => default path, otherwise explicit file path
    const normLogRecords: Array<Record<string, unknown>> = [];
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
  let files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  // Exclude internal manifest file if present
  const MANIFEST_NAME = '_manifest.json';
  files = files.filter(f => f !== MANIFEST_NAME);
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
  // Reason counters (accepted tracked separately). We increment a reason only on *skipped* decisions.
  const reasonCounts: Record<string, number> = {};
  const salvageCounts: Record<string, number> = {};
  const softWarnings: Record<string, number> = {};
  const bump = (r: string) => { reasonCounts[r] = (reasonCounts[r]||0)+1; };
  const salvage = (k: string) => { salvageCounts[k] = (salvageCounts[k]||0)+1; };
  const warnSoft = (k: string) => { softWarnings[k] = (softWarnings[k]||0)+1; };
  // Helper for unconditional lightweight event emission (stdout/stderr JSON line) independent of trace flags.
  const emitCatalogEvent = (ev: Record<string, unknown>) => {
    try {
      const line = JSON.stringify({ level: 'info', event: 'catalog-file', ...ev });
      (process.stderr.write as (chunk: string) => boolean)(line + '\n');
    } catch { /* ignore */ }
  };

  for(const f of files){
      scannedSoFar++;
      if(traceEnabled(1)){
        try { emitTrace('[trace:catalog:file-begin]', { file: f, index: scannedSoFar - 1, total: files.length }); } catch { /* ignore */ }
      }
      else {
        // Always-on minimal begin event
        emitCatalogEvent({ phase: 'begin', file: f, index: scannedSoFar - 1, total: files.length });
      }
  const full = path.join(dir, f);
      // Recursion / governance denial: prevent ingestion of files that originate from
      // repository governance or specification seed areas that must not become part of
      // the live instruction catalog (avoids knowledge recursion loops).
      // We rely on a simple fast path filename / parent folder heuristic here because
      // governance artifacts are intentionally never written into the primary instructions
      // directory. However, defensive hardening protects against accidental copy or user
      // misplacement (e.g., copying specs/*.json into instructions/).
      // Deny patterns (case-insensitive):
      //  - files whose basename starts with '000-bootstrapper' or '001-knowledge-index-lifecycle'
      //  - any file containing '.governance.' marker (future use)
      //  - any file named 'constitution.json'
      //  - any file whose first line (if readable) contains marker '__GOVERNANCE_SEED__'
      const lowerBase = f.toLowerCase();
      let denied = false;
      if(/^(000-bootstrapper|001-lifecycle-bootstrap)/.test(lowerBase)) denied = true;
      else if(lowerBase.includes('.governance.')) denied = true;
      else if(lowerBase === 'constitution.json') denied = true;
      if(!denied){
        try {
          // Very small peek (first 200 bytes) – safe even for large files
            const peek = fs.readFileSync(full, { encoding: 'utf8', flag: 'r' }).slice(0,200);
            if(/__GOVERNANCE_SEED__/.test(peek)) denied = true;
        } catch { /* ignore peek errors */ }
      }
      if(denied){
        bump('ignored:governance-denylist');
        if(trace) trace.push({ file:f, accepted:false, reason:'ignored:governance-denylist' });
        if(traceEnabled(1)){
          try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason: 'ignored:governance-denylist', scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
          try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
        }
        else { emitCatalogEvent({ phase: 'end', file: f, accepted: false, reason: 'ignored:governance-denylist', scanned: scannedSoFar, acceptedSoFar }); }
        continue;
      }
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
            else { emitCatalogEvent({ phase: 'end', file: f, accepted: true, cached: true, scanned: scannedSoFar, acceptedSoFar }); }
          }
        } catch { /* stat or reuse failure falls through to normal path */ }
      }
      if(reused) continue;
      // Exclude any files within a _templates directory (non-runtime placeholders)
      if(full.includes(`${path.sep}_templates${path.sep}`)){
        bump('ignored:template');
        if(trace) trace.push({ file:f, accepted:false, reason:'ignored:template' });
        if(traceEnabled(1)){
          try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason: 'ignored:template', scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
          try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
        }
        else { emitCatalogEvent({ phase: 'end', file: f, accepted: false, reason: 'ignored:template', scanned: scannedSoFar, acceptedSoFar }); }
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
              else { emitCatalogEvent({ phase: 'end', file: f, accepted: true, cached: true, hash: true, scanned: scannedSoFar, acceptedSoFar }); }
              continue; // proceed next file
            }
          } catch { /* fall through to normal parse */ }
        }
  const rawAny = this.readJsonWithRetry(full) as Record<string, unknown>;
        // Ignore clearly non-instruction config files (no id/title/body/requirement) e.g. gates.json
        const looksInstruction = typeof rawAny.id === 'string' && typeof rawAny.title === 'string' && typeof rawAny.body === 'string';
        if(!looksInstruction){
          bump('ignored:non-instruction-config');
          if(trace) trace.push({ file:f, accepted:false, reason:'ignored:non-instruction-config' });
          if(traceEnabled(1)){
            try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason: 'ignored:non-instruction-config', scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
            try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
          }
          else { emitCatalogEvent({ phase: 'end', file: f, accepted: false, reason: 'ignored:non-instruction-config', scanned: scannedSoFar, acceptedSoFar }); }
          continue;
        }
        // Clone to typed object after basic shape check
  const raw = rawAny as unknown as InstructionEntry; // validated progressively below
        
        // Capture pre-normalization snapshot for diff (only selected keys we may mutate)
        type NormalizationSnapshot = {
          id?: string;
          audience?: InstructionEntry['audience'];
          requirement?: InstructionEntry['requirement'];
          categories?: string[];
          primaryCategory?: string;
        };
        const preSnapshot: NormalizationSnapshot = {
          id: (raw as Partial<InstructionEntry>).id,
          audience: (raw as Partial<InstructionEntry>).audience,
          requirement: (raw as Partial<InstructionEntry>).requirement,
          categories: Array.isArray((raw as Partial<InstructionEntry>).categories) ? [ ...(raw as Partial<InstructionEntry>).categories as string[] ] : undefined,
          primaryCategory: (raw as Partial<InstructionEntry>).primaryCategory
        };

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
  // BEGIN legacy enum normalization (no flags, always-on). This upgrades historical values to v3 schema enums.
  try {
    const legacyAudienceMap: Record<string,string> = {
      'system':'all', // legacy broad scope
      'developers':'group',
      'developer':'individual',
      'team':'group',
      'teams':'group',
      'users':'group',
      'dev':'individual',
      'devs':'group',
      // newly observed variants
      'testers':'group',
      'administrators':'group',
      'admins':'group',
      'agents':'group',
      'powershell script authors':'group'
    };
    const legacyRequirementMap: Record<string,string> = {
      'MUST':'mandatory',
      'SHOULD':'recommended',
      'MAY':'optional',
      'CRITICAL':'critical', // legacy capitalization variant
      'OPTIONAL':'optional',
      'MANDATORY':'mandatory',
      'DEPRECATED':'deprecated',
      // newly observed variant
      'REQUIRED':'mandatory'
    };
    let changedLegacy = false;
    const anyMut = mutRaw as unknown as Record<string, unknown>;
    if(typeof anyMut.audience === 'string'){
      const lower = (anyMut.audience as string).toLowerCase();
      // try exact key, then lower-case key
      if(legacyAudienceMap[anyMut.audience as string]){ anyMut.audience = legacyAudienceMap[anyMut.audience as string]; changedLegacy = true; salvage('audience'); }
      else if(legacyAudienceMap[lower]){ anyMut.audience = legacyAudienceMap[lower]; changedLegacy = true; salvage('audience'); }
      else if(/author|script\s+author/i.test(lower)) { anyMut.audience = 'individual'; changedLegacy = true; salvage('audience'); }
    }
    if(typeof anyMut.requirement === 'string'){
      const req = anyMut.requirement as string;
      if(legacyRequirementMap[req]){ anyMut.requirement = legacyRequirementMap[req]; changedLegacy = true; salvage('requirement'); }
      else {
        const upper = req.toUpperCase();
        if(legacyRequirementMap[upper]){ anyMut.requirement = legacyRequirementMap[upper]; changedLegacy = true; salvage('requirement'); }
        else if(/\s/.test(req) && req.length < 300){
          // Free-form sentence / description -> degrade to recommended (heuristic)
          anyMut.requirement = 'recommended'; changedLegacy = true; salvage('requirementFreeform');
        }
      }
    }
    // Category + primaryCategory sanitization: lowercase, remove invalid chars, collapse multiple separators
    const sanitizeCat = (v: string): string => {
      let out = v.toLowerCase().trim();
      out = out.replace(/[^a-z0-9-_]/g,'-'); // replace invalid with '-'
      out = out.replace(/-{2,}/g,'-').replace(/_{2,}/g,'_');
      out = out.replace(/^-+/, '').replace(/-+$/, '');
      out = out.slice(0,49);
      if(!out.match(/^[a-z0-9][a-z0-9-_]*$/)){
        // fallback id-like token if still invalid
        out = out.replace(/^[^a-z0-9]+/,'');
        if(!out) out = 'uncategorized';
      }
      return out;
    };
    const mutPartial = anyMut as Partial<InstructionEntry> & { categories?: string[] };
    if(Array.isArray(mutPartial.categories)){
      const before = JSON.stringify(mutPartial.categories);
      mutPartial.categories = mutPartial.categories
        .filter((c: unknown): c is string => typeof c === 'string')
        .map((c) => sanitizeCat(c))
        .filter((c, idx, arr) => c.length && arr.indexOf(c)===idx)
        .slice(0,25);
      if(before !== JSON.stringify(mutPartial.categories)) changedLegacy = true;
    }
    if(typeof mutPartial.primaryCategory === 'string'){
      const pc = sanitizeCat(mutPartial.primaryCategory);
      if(pc !== mutPartial.primaryCategory){ mutPartial.primaryCategory = pc; changedLegacy = true; }
      // ensure membership
      if(Array.isArray(mutPartial.categories) && !mutPartial.categories.includes(pc)){
        mutPartial.categories.push(pc); changedLegacy = true;
      }
    }
    // ID sanitization (only if currently invalid but has recognizable content). Avoid changing valid ids.
    if(typeof anyMut.id === 'string'){
      if(!/^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$/.test(anyMut.id)){
        const orig = anyMut.id;
        let id = orig.toLowerCase().trim();
        id = id.replace(/[^a-z0-9-_]/g,'-');
        id = id.replace(/-{2,}/g,'-').replace(/_{2,}/g,'_');
        id = id.replace(/^-+/, '').replace(/-+$/, '');
        id = id.slice(0,120);
        if(id && /^[a-z0-9]/.test(id) && /[a-z0-9]$/.test(id)){
          anyMut.id = id;
          changedLegacy = true;
        }
      }
    }
    if(changedLegacy){
      needsRewrite = true; // ensure persisted normalization
      try {
        // Produce diff (post-normalization snapshot limited to mutated fields)
        const postSnapshot: NormalizationSnapshot = {
          id: (anyMut as Partial<InstructionEntry>).id,
          audience: (anyMut as Partial<InstructionEntry>).audience,
          requirement: (anyMut as Partial<InstructionEntry>).requirement,
          categories: Array.isArray((anyMut as Partial<InstructionEntry>).categories) ? [ ...(anyMut as Partial<InstructionEntry>).categories as string[] ] : undefined,
          primaryCategory: (anyMut as Partial<InstructionEntry>).primaryCategory
        };
        const changed: Record<string, { before: unknown; after: unknown }> = {};
        for(const k of Object.keys(postSnapshot) as Array<keyof typeof postSnapshot>){
          const beforeVal = (preSnapshot as Record<string, unknown>)[k as string];
          const afterVal = (postSnapshot as Record<string, unknown>)[k as string];
          const beforeJSON = JSON.stringify(beforeVal);
          const afterJSON = JSON.stringify(afterVal);
          if(beforeJSON !== afterJSON){
            changed[k as string] = { before: beforeVal, after: afterVal };
          }
        }
        if(Object.keys(changed).length){
          normLogRecords.push({
            ts: new Date().toISOString(),
            file: f,
            originalId: preSnapshot.id,
            finalId: (anyMut as Partial<InstructionEntry>).id,
            changes: changed
          });
        }
      } catch { /* ignore diff / logging errors */ }
    }
  } catch { /* swallow normalization failure */ }
  // END legacy enum normalization
  // Preprocess placeholder governance fields: convert empty strings to undefined so schema doesn't reject
        const placeholderKeys: (keyof InstructionEntry)[] = ['createdAt','updatedAt','lastReviewedAt','nextReviewDue','priorityTier','semanticSummary'];
        for(const k of placeholderKeys){
          const v = (mutRaw as unknown as Record<string, unknown>)[k];
          if(v === ''){ delete (mutRaw as unknown as Record<string, unknown>)[k]; }
        }
        // Soft warning for large body approaching limit ( >18000 but <=20000 )
        try {
          if(typeof mutRaw.body === 'string' && mutRaw.body.length > 18000 && mutRaw.body.length <= 20000){ warnSoft('body:near-limit'); }
        } catch { /* ignore */ }
        // Pre-schema salvage of clearly invalid enum values (post legacy normalization). This converts would-be
        // schema rejections into accepted entries with a salvage marker to prevent noisy drift in environments
        // where upstream authoring tools haven't yet been updated. These rules are intentionally conservative.
        try {
          interface MutableInstruction { audience?: string; requirement?: string; priority?: number; priorityTier?: string; body?: string; }
          const mi = mutRaw as unknown as MutableInstruction;
          if(mi){
            if(typeof mi.audience === 'string' && !['individual','group','all'].includes(mi.audience)){
              mi.audience = 'all';
              salvage('audienceInvalid');
            }
            if(typeof mi.requirement === 'string' && !['mandatory','critical','recommended','optional','deprecated'].includes(mi.requirement)){
              mi.requirement = 'recommended';
              salvage('requirementInvalid');
            }
            if(typeof mi.priority !== 'number' || mi.priority < 1 || mi.priority > 100){
              mi.priority = 50;
              salvage('priorityInvalid');
            }
            if(typeof mi.priorityTier === 'string' && !['P1','P2','P3','P4'].includes(mi.priorityTier)){
              delete mi.priorityTier;
              salvage('priorityTierInvalid');
            }
            if(typeof mi.body === 'string' && mi.body.length > 20000){
              if(mi.body.length <= 24000){
                mi.body = mi.body.slice(0,20000);
                salvage('bodyTruncated');
                warnSoft('body:truncated');
              }
            }
          }
        } catch { /* salvage is best-effort */ }

        if(!validate(mutRaw)){
          // Enhanced detailed error reasons referencing each failing path
          interface AjvErr { instancePath?: string; message?: string; params?: Record<string, unknown>; schemaPath?: string }
          const ajvErrs = (validate as unknown as { errors?: AjvErr[] }).errors;
          let detailed = '';
          if(Array.isArray(ajvErrs) && ajvErrs.length){
            detailed = ajvErrs.map(e => {
              const path = e.instancePath && e.instancePath.length ? e.instancePath : '(root)';
              let msg = e.message || 'invalid';
              if(e.params && typeof e.params.allowedValues !== 'undefined'){
                msg += ` allowed: ${JSON.stringify(e.params.allowedValues)}`;
              }
              return `${path}: ${msg}`;
            }).join('; ');
          } else {
            detailed = ajv.errorsText();
          }
          const reason = 'schema: ' + (detailed || 'validation failed');
          errors.push({ file: f, error: reason });
          bump('schema');
          if(trace) trace.push({ file:f, accepted:false, reason });
          if(traceEnabled(1)){
            try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
            try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
          }
          else { emitCatalogEvent({ phase: 'end', file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); }
          continue;
        }
  const issues = this.classifier.validate(mutRaw);
        if(issues.length){
          const reason = issues.join(', ');
          errors.push({ file: f, error: reason });
          bump('classification');
          if(trace) trace.push({ file:f, accepted:false, reason });
          if(traceEnabled(1)){
            try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
            try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
          }
          else { emitCatalogEvent({ phase: 'end', file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); }
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
        else { emitCatalogEvent({ phase: 'end', file: f, accepted: true, scanned: scannedSoFar, acceptedSoFar }); }
      } catch(e: unknown){
        const reason = e instanceof Error ? e.message : 'unknown error';
        errors.push({ file: f, error: reason });
        bump('error');
        if(trace) trace.push({ file:f, accepted:false, reason });
        if(traceEnabled(1)){
          try { emitTrace('[trace:catalog:file-end]', { file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); } catch { /* ignore */ }
          try { emitTrace('[trace:catalog:file-progress]', { scanned: scannedSoFar, total: files.length, acceptedSoFar, rejectedSoFar: scannedSoFar - acceptedSoFar }); } catch { /* ignore */ }
        }
        else { emitCatalogEvent({ phase: 'end', file: f, accepted: false, reason, scanned: scannedSoFar, acceptedSoFar }); }
      }
    }
    const hash = this.computeCatalogHash(entries);
    const summary: CatalogLoadSummary = {
      scanned: files.length,
      accepted: entries.length,
      skipped: files.length - entries.length,
      reasons: reasonCounts,
      cacheHits: cacheHits || undefined,
      hashHits: hashHits || undefined,
      salvage: Object.keys(salvageCounts).length ? salvageCounts : undefined,
      softWarnings: Object.keys(softWarnings).length ? softWarnings : undefined
    };
    // Always emit a single-line summary to stderr for deterministic external diagnostics.
    try {
      const line = JSON.stringify({ level: 'info', event: 'catalog-summary', ...summary });
      (process.stderr.write as (chunk: string) => boolean)(line + '\n');
    } catch { /* ignore logging failure */ }

    // Generate manifest file with accepted entries + summary for external tooling and validate against schema.
    try {
      const manifestEntries = entries.map(e => {
        let bodyHash = '';
        try { bodyHash = crypto.createHash('sha256').update(e.body,'utf8').digest('hex'); } catch { /* ignore */ }
        return {
          id: e.id,
          title: e.title,
          priority: e.priority,
          priorityTier: (e as InstructionEntry).priorityTier,
          audience: e.audience,
          requirement: e.requirement,
          sourceHash: e.sourceHash,
          bodyHash
        };
      });
      const manifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        count: manifestEntries.length,
        hash,
        summary,
        entries: manifestEntries
      };
      // Validate manifest against schema (best-effort, non-fatal)
      try {
        const manifestSchemaPath = path.join(process.cwd(),'schemas','manifest.schema.json');
        if(fs.existsSync(manifestSchemaPath)){
          try {
            const sRaw = fs.readFileSync(manifestSchemaPath,'utf8');
            const sJson = JSON.parse(sRaw);
            const ajvManifest = new Ajv({ allErrors: true, strict: false });
            addFormats(ajvManifest);
            const validateManifest = ajvManifest.compile(sJson as unknown as Record<string, unknown>);
            if(!validateManifest(manifest)){
              const errs = validateManifest.errors?.map(e=>`${e.instancePath||'(root)'} ${e.message}`).join('; ');
              const line = JSON.stringify({ level:'warn', event:'catalog-manifest-validation-failed', errors: errs });
              (process.stderr.write as (chunk:string)=>boolean)(line+'\n');
            }
          } catch { /* ignore schema validation errors */ }
        }
      } catch { /* ignore validation wrapper errors */ }
      const manifestPath = path.join(dir, MANIFEST_NAME);
      const tmpPath = manifestPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
      fs.renameSync(tmpPath, manifestPath); // atomic replace
    } catch { /* ignore manifest failure */ }

    // Emit skipped details artifact (_skipped.json) for transparency
    try {
      const skipped = errors.map(e => ({ file: e.file, reason: e.error }));
      const skippedPath = path.join(dir, '_skipped.json');
      const tmpSkipped = skippedPath + '.tmp';
      const payload = { generatedAt: new Date().toISOString(), count: skipped.length, items: skipped };
      fs.writeFileSync(tmpSkipped, JSON.stringify(payload, null, 2));
      fs.renameSync(tmpSkipped, skippedPath);
    } catch { /* ignore skipped artifact failure */ }
    // Emit normalization audit log if enabled and we have records
    if(normLogEnv && normLogRecords.length){
      try {
  const target = normLogEnv === '1' ? path.join(process.cwd(), 'logs', 'normalization-audit.jsonl') : normLogEnv;
        const targetDir = path.dirname(target);
        if(!fs.existsSync(targetDir)){
          try { fs.mkdirSync(targetDir, { recursive: true }); } catch { /* ignore */ }
        }
        const fd = fs.openSync(target, 'a');
        try {
          for(const rec of normLogRecords){
            fs.writeSync(fd, JSON.stringify(rec) + '\n');
          }
        } finally { try { fs.closeSync(fd); } catch { /* ignore */ } }
      } catch { /* silent failure */ }
    }
    if(memoryCacheEnabled && (cacheHits || hashHits) && traceEnabled(1)){
      try { emitTrace('[trace:catalog:cache-summary]', { hits: cacheHits, hashHits, scanned: files.length, percent: Number(((cacheHits+hashHits) / files.length * 100).toFixed(2)) }); } catch { /* ignore */ }
    }
    if(traceEnabled(1)){
      try { emitTrace('[trace:catalog:load-end]', { dir, durationMs: Date.now()-loadStart, accepted: entries.length, skipped: files.length-entries.length }); } catch { /* ignore */ }
    }
    return { entries, errors, hash, debug: { scanned: files.length, accepted: entries.length, skipped: files.length - entries.length, trace }, summary };
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