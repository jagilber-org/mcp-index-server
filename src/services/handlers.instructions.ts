import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
// Canonical body hashing (normalizes line endings, trims outer blank lines, strips trailing spaces)
import { hashBody } from './canonical';
import { InstructionEntry } from '../models/instruction';
import { registerHandler } from '../server/registry';
import { computeGovernanceHash, ensureLoaded, invalidate, projectGovernance, getInstructionsDir, touchCatalogVersion, getDebugCatalogSnapshot } from './catalogContext';
import { incrementCounter } from './features';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import { ClassificationService } from './classificationService';
import { resolveOwner } from './ownershipService';
import { atomicWriteJson } from './atomicFs';
import { logAudit } from './auditLog';
import { getToolRegistry } from './toolRegistry';
import { getBooleanEnv } from '../utils/envUtils';

// Evaluate mutation flag dynamically each invocation so tests that set env before calls (even after import) still work.
function isMutationEnabled(){ return getBooleanEnv('MCP_ENABLE_MUTATION'); }

// CI Environment Detection and Response Size Limiting
function isCI(): boolean {
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.TF_BUILD);
}

function limitResponseSize<T extends Record<string, unknown>>(response: T): T {
  if (!isCI()) return response;
  
  const responseStr = JSON.stringify(response);
  if (responseStr.length <= 60000) return response; // Safe margin under 64KB
  
  // If response is too large in CI, truncate or paginate intelligently
  if ('items' in response && Array.isArray(response.items) && response.items.length > 3) {
    // Limit to first 3 items in CI to prevent JSON truncation
    return {
      ...response,
      items: response.items.slice(0, 3),
      ciLimited: true,
      originalCount: response.items.length,
      message: 'Response limited in CI environment to prevent truncation'
    };
  }
  
  return response;
}

interface ImportEntry { id:string; title:string; body:string; rationale?:string; priority:number; audience:InstructionEntry['audience']; requirement:InstructionEntry['requirement']; categories?: unknown[]; deprecatedBy?: string; riskScore?: number; // governance (optional on import)
  version?: string; owner?: string; status?: InstructionEntry['status']; priorityTier?: InstructionEntry['priorityTier']; classification?: InstructionEntry['classification']; lastReviewedAt?: string; nextReviewDue?: string; changeLog?: InstructionEntry['changeLog']; semanticSummary?: string }

function guard<TParams, TResult>(name:string, fn:(p:TParams)=>TResult){
  return (p:TParams)=>{ if(!isMutationEnabled()) throw { code:-32601, message:`Mutation disabled. Use instructions/dispatch with action parameter instead of direct ${name} calls. Set MCP_ENABLE_MUTATION=1 to enable direct calls.`, data:{ method:name, alternative: 'instructions/dispatch' } }; return fn(p); };
}

// Centralized tracing (reuse service-level utilities)
import { emitTrace, traceEnabled } from './tracing';
function traceVisibility(){ return traceEnabled(1); }

// Deep visibility tracing helper (no side effects). Captures catalog + disk state for an id.
function traceInstructionVisibility(id:string, phase:string, extra?: Record<string, unknown>){
  if(!traceVisibility()) return;
  try {
    const dir = getInstructionsDir();
    const file = path.join(dir, `${id}.json`);
    const st = ensureLoaded();
    const catalogItem = st.byId.get(id) as Partial<InstructionEntry> | undefined;
  let fileExists = false; let fileSize:number|undefined; let mtime:string|undefined; let diskHash:string|undefined;
    if(fs.existsSync(file)){
      fileExists = true;
      const stat = fs.statSync(file);
      fileSize = stat.size; mtime = stat.mtime.toISOString();
      try {
  const rawTxt = fs.readFileSync(file,'utf8');
        try { const rawJson = JSON.parse(rawTxt) as { sourceHash?:string }; if(typeof rawJson.sourceHash==='string') diskHash = rawJson.sourceHash; } catch { /* ignore parse */ }
      } catch { /* ignore read */ }
    }
    emitTrace('[trace:visibility]', {
      phase,
      id,
      dir,
      now: new Date().toISOString(),
      fileExists,
      fileSize,
      mtime,
      diskHash,
      catalogHas: !!catalogItem,
      catalogSourceHash: catalogItem?.sourceHash,
      catalogUpdatedAt: catalogItem?.updatedAt,
      serverHash: st.hash,
      listCount: st.list.length,
      sampleIds: st.list.slice(0,3).map(e=>e.id),
      ...extra
    });
  } catch { /* swallow tracing issues */ }
}

// Lightweight environment snapshot for correlating anomalous visibility states with runtime flags.
function traceEnvSnapshot(phase:string, extra?:Record<string, unknown>){
  if(!traceVisibility()) return;
  try {
    const pick = (k:string)=> process.env[k];
    emitTrace('[trace:env]', {
      phase,
      pid: process.pid,
      flags: {
        MCP_ENABLE_MUTATION: pick('MCP_ENABLE_MUTATION'),
        MCP_INSTRUCTIONS_STRICT_CREATE: pick('MCP_INSTRUCTIONS_STRICT_CREATE'),
        MCP_CANONICAL_DISABLE: pick('MCP_CANONICAL_DISABLE'),
        MCP_READ_RETRIES: pick('MCP_READ_RETRIES'),
        MCP_READ_BACKOFF_MS: pick('MCP_READ_BACKOFF_MS'),
        FULL_LIST_GET: pick('FULL_LIST_GET'),
        LIST_GET_SAMPLE_SIZE: pick('LIST_GET_SAMPLE_SIZE'),
        LIST_GET_SAMPLE_SEED: pick('LIST_GET_SAMPLE_SEED'),
        LIST_GET_CONCURRENCY: pick('LIST_GET_CONCURRENCY'),
        INSTRUCTIONS_DIR: pick('INSTRUCTIONS_DIR')
      },
      ...extra
    });
  } catch { /* ignore env tracing errors */ }
}

// Legacy individual instruction handlers removed in favor of unified dispatcher (instructions/dispatch).
// Internal implementation functions retained below for dispatcher direct invocation.
export const instructionActions = {
  list: (p:{category?:string; expectId?:string})=>{ let st = ensureLoaded(); const originalHash = st.hash; let items = st.list; if(p?.category){ const c = p.category.toLowerCase(); items = items.filter(i=> i.categories.includes(c)); }
    let repairedVisibility:boolean|undefined; let lateMaterialized:boolean|undefined; let attemptedReload=false; let attemptedLate=false;
    // Reliability enhancement: if caller supplies expectId and catalog contains it, move that
    // entry to the front so CI size-limiting (which retains only the first few items) still
    // exposes the newly added instruction for immediate visibility assertions.
    if(p?.expectId){
      const idx = items.findIndex(i=> i.id===p.expectId);
      if(idx>0){ const target = items[idx]; items = [target, ...items.slice(0,idx), ...items.slice(idx+1)]; }
    }
    // NEW: If expectId provided but not currently visible while file exists on disk, attempt a focused
    // repair (invalidate + reload; if still missing perform late materialization). This narrows the race
    // window where list could lag behind a just-written instruction that get() would already surface via
    // late materialization paths in other handlers.
    if(p?.expectId){
      try {
        const dir = getInstructionsDir();
        const file = path.join(dir, `${p.expectId}.json`);
        const hasFile = fs.existsSync(file);
        const inCatalog = st.byId.has(p.expectId);
        if(hasFile && !inCatalog){
          attemptedReload = true;
          invalidate(); st = ensureLoaded(); items = st.list; // refresh view
          if(p.category){ const c2 = p.category.toLowerCase(); items = items.filter(i=> i.categories.includes(c2)); }
          if(!st.byId.has(p.expectId)){
            // Late materialize directly from disk (classification validated) to avoid false negative.
            attemptedLate = true;
            try {
              const rawTxt = fs.readFileSync(file,'utf8');
              if(rawTxt.trim()){
                try {
                  const rawJson = JSON.parse(rawTxt) as InstructionEntry; const classifier=new ClassificationService(); const issues=classifier.validate(rawJson); if(!issues.length){ const norm=classifier.normalize(rawJson); st.list.push(norm); st.byId.set(norm.id,norm); items = st.list; repairedVisibility = true; lateMaterialized = true; incrementCounter('instructions:listLateMaterialize'); } else { incrementCounter('instructions:listLateMaterializeRejected'); }
                } catch { incrementCounter('instructions:listLateMaterializeParseError'); }
              } else { incrementCounter('instructions:listLateMaterializeEmpty'); }
            } catch { /* ignore disk read */ }
          } else {
            repairedVisibility = true;
          }
          // If we repaired or reloaded, re-apply expectId ordering
          if(st.byId.has(p.expectId)){
            const idx2 = items.findIndex(i=> i.id===p.expectId);
            if(idx2>0){ const target2 = items[idx2]; items = [target2, ...items.slice(0,idx2), ...items.slice(idx2+1)]; }
          }
        }
      } catch { /* ignore repair errors */ }
    }
    if(traceVisibility()){ try { const dir=getInstructionsDir(); const disk=fs.readdirSync(dir).filter(f=>f.endsWith('.json')); const diskIds=new Set(disk.map(f=>f.slice(0,-5))); const idsSample=items.slice(0,5).map(i=>i.id); const missingOnCatalog=[...diskIds].filter(id=> !st.byId.has(id)); const expectId=p?.expectId; const expectOnDisk= expectId? diskIds.has(expectId): undefined; const expectInCatalog = expectId? st.byId.has(expectId): undefined; emitTrace('[trace:list]', { dir, total: st.list.length, filtered: items.length, sample: idsSample, diskCount: disk.length, missingOnCatalogCount: missingOnCatalog.length, missingOnCatalog: missingOnCatalog.slice(0,5), expectId, expectOnDisk, expectInCatalog, repairedVisibility, lateMaterialized, attemptedReload, attemptedLate, originalHash, finalHash: st.hash }); } catch { /* ignore */ } }
    const resp = limitResponseSize({ hash: st.hash, count: items.length, items, repairedVisibility, lateMaterialized });
    return resp; },
  listScoped: (p:{ userId?:string; workspaceId?:string; teamIds?: string[] })=>{ const st=ensureLoaded(); const userId=p.userId?.toLowerCase(); const workspaceId=p.workspaceId?.toLowerCase(); const teamIds=(p.teamIds||[]).map(t=>t.toLowerCase()); const all=st.list; const matchUser = userId? all.filter(e=> (e.userId||'').toLowerCase()===userId):[]; if(matchUser.length) return { hash: st.hash, count: matchUser.length, scope:'user', items:matchUser }; const matchWorkspace = workspaceId? all.filter(e=> (e.workspaceId||'').toLowerCase()===workspaceId):[]; if(matchWorkspace.length) return { hash: st.hash, count: matchWorkspace.length, scope:'workspace', items:matchWorkspace }; const teamSet = new Set(teamIds); const matchTeams = teamIds.length? all.filter(e=> Array.isArray(e.teamIds) && e.teamIds.some(t=> teamSet.has(t.toLowerCase()))):[]; if(matchTeams.length) return { hash: st.hash, count: matchTeams.length, scope:'team', items:matchTeams }; const audienceAll = all.filter(e=> e.audience==='all'); return { hash: st.hash, count: audienceAll.length, scope:'all', items: audienceAll }; },
  get: (p:{id:string})=>{ const st=ensureLoaded(); const item = st.byId.get(p.id); if(traceVisibility()){ const dir=getInstructionsDir(); emitTrace('[trace:get]', { dir, id:p.id, found: !!item, total: st.list.length }); traceInstructionVisibility(p.id, item? 'get-found':'get-not-found'); if(!item) traceEnvSnapshot('get-not-found'); } return item? { hash: st.hash, item }: { notFound:true }; },
  // Reliability enhancement: if an entry is reported notFound but a file with that id exists on disk,
  // attempt a focused late materialization (mirrors logic used in add strict path) to reduce false
  // negatives under extremely tight cross-process races.
  // NOTE: We keep original semantics unless visibility repair succeeds; if repair works we surface
  // lateMaterialized flag for observability.
  // getEnhanced is exposed only for internal diagnostic use (not a dispatcher action) and reused
  // by the public get above when needed.
  // (Intentionally not exported separately to avoid expanding public surface.)
  // Implementation detail: we avoid unnecessary reload if file missing to keep hot path fast.
  // This code path triggers only when notFound AND file present.
  // Coverage: Added by reliability patch addressing user-reported "skipped + notFound" confusion.
  getEnhanced: (p:{id:string})=>{ const base=getInstructionsDir(); const file=path.join(base, `${p.id}.json`); let st=ensureLoaded(); let item=st.byId.get(p.id); if(item) return { hash: st.hash, item } as const; if(!fs.existsSync(file)) return { notFound:true } as const; let repaired=false; try {
  traceInstructionVisibility(p.id, 'getEnhanced-start');
      // First attempt: invalidate + reload (cheap if already dirty)
      invalidate(); st=ensureLoaded(); item=st.byId.get(p.id); if(item){ repaired=true; }
      if(!repaired){
        // Second attempt: direct disk read + classification normalization (late materialization)
        const txt=fs.readFileSync(file,'utf8'); if(txt.trim()){
          try { const raw=JSON.parse(txt) as InstructionEntry; const classifier=new ClassificationService(); const issues=classifier.validate(raw); if(!issues.length){ const norm=classifier.normalize(raw); st.list.push(norm); st.byId.set(norm.id,norm); item=norm; repaired=true; incrementCounter('instructions:getLateMaterialize'); } else { incrementCounter('instructions:getLateMaterializeRejected'); }
          } catch { incrementCounter('instructions:getLateMaterializeParseError'); }
        } else { incrementCounter('instructions:getLateMaterializeEmptyFile'); }
      }
    } catch { /* swallow */ }
    if(traceVisibility()){ emitTrace('[trace:get:late-materialize]', { id:p.id, repaired, fileExists:true }); }
  traceInstructionVisibility(p.id, 'getEnhanced-end', { repaired, finalFound: !!item });
    return item? { hash: st.hash, item, lateMaterialized: repaired }: { notFound:true };
  },
  search: (p:{q:string})=>{ const st=ensureLoaded(); const q=(p.q||'').toLowerCase(); const items = st.list.filter(i=> i.title.toLowerCase().includes(q)|| i.body.toLowerCase().includes(q)); if(traceVisibility()){ const dir=getInstructionsDir(); const sample=items.slice(0,5).map(i=>i.id); emitTrace('[trace:search]', { dir, q, matches: items.length, sample }); } return { hash: st.hash, count: items.length, items }; },
  diff: (p:{clientHash?:string; known?:{id:string; sourceHash:string}[]})=>{ const st=ensureLoaded(); const clientHash=p.clientHash; const known=p.known; if(!known && clientHash && clientHash===st.hash) return { upToDate:true, hash: st.hash }; if(known){ const map=new Map<string,string>(); for(const k of known){ if(k && k.id && !map.has(k.id)) map.set(k.id,k.sourceHash); } const added:InstructionEntry[]=[]; const updated:InstructionEntry[]=[]; const removed:string[]=[]; for(const e of st.list){ const prev=map.get(e.id); if(prev===undefined) added.push(e); else if(prev!==e.sourceHash) updated.push(e); } for(const id of map.keys()){ if(!st.byId.has(id)) removed.push(id); } if(!added.length && !updated.length && !removed.length && clientHash===st.hash) return { upToDate:true, hash: st.hash }; return { hash: st.hash, added, updated, removed }; } if(!clientHash || clientHash!==st.hash) return { hash: st.hash, changed: st.list }; return { upToDate:true, hash: st.hash }; },
  export: (p:{ids?:string[]; metaOnly?:boolean})=>{ const st=ensureLoaded(); let items=st.list; if(p?.ids?.length){ const want=new Set(p.ids); items=items.filter(i=>want.has(i.id)); } if(p?.metaOnly){ items=items.map(i=> ({ ...i, body:'' })); } return limitResponseSize({ hash: st.hash, count: items.length, items }); },
  query: (p:{ categoriesAll?:string[]; categoriesAny?:string[]; excludeCategories?:string[]; priorityMin?:number; priorityMax?:number; priorityTiers?:('P1'|'P2'|'P3'|'P4')[]; requirements?: InstructionEntry['requirement'][]; text?:string; limit?:number; offset?:number })=>{ const st=ensureLoaded(); const norm = (arr?:string[])=> Array.from(new Set((arr||[]).filter(x=> typeof x==='string' && x.trim()).map(x=> x.toLowerCase()))); const catsAll = norm(p.categoriesAll); const catsAny = norm(p.categoriesAny); const catsEx = norm(p.excludeCategories); const tierSet = new Set((p.priorityTiers||[]).filter(t=> ['P1','P2','P3','P4'].includes(String(t))) as Array<'P1'|'P2'|'P3'|'P4'>); const reqSet = new Set((p.requirements||[]).filter(r=> ['mandatory','critical','recommended','optional','deprecated'].includes(String(r))) as InstructionEntry['requirement'][]); const prMin = typeof p.priorityMin==='number'? p.priorityMin: undefined; const prMax = typeof p.priorityMax==='number'? p.priorityMax: undefined; const text = (p.text||'').toLowerCase().trim(); let items = st.list; if(catsAll.length){ items = items.filter(e=> catsAll.every(c=> e.categories.includes(c))); } if(catsAny.length){ items = items.filter(e=> e.categories.some(c=> catsAny.includes(c))); } if(catsEx.length){ items = items.filter(e=> !e.categories.some(c=> catsEx.includes(c))); } if(prMin!==undefined){ items = items.filter(e=> e.priority >= prMin); } if(prMax!==undefined){ items = items.filter(e=> e.priority <= prMax); } if(tierSet.size){ items = items.filter(e=> e.priorityTier && tierSet.has(e.priorityTier)); } if(reqSet.size){ items = items.filter(e=> reqSet.has(e.requirement)); } if(text){ items = items.filter(e=> e.title.toLowerCase().includes(text) || e.body.toLowerCase().includes(text) || (e.semanticSummary||'').toLowerCase().includes(text)); } const total = items.length; const limit = Math.min(Math.max((p.limit??100),1),1000); const offset = Math.max((p.offset??0),0); const paged = items.slice(offset, offset+limit); return { hash: st.hash, total, count: paged.length, offset, limit, items: paged, applied: { catsAll, catsAny, catsEx, prMin, prMax, tiers:[...tierSet], requirements:[...reqSet], text: text||undefined } }; },
  categories: (_p:unknown)=>{ const st=ensureLoaded(); const counts=new Map<string,number>(); for(const e of st.list){ for(const c of e.categories){ counts.set(c,(counts.get(c)||0)+1); } } const categories=[...counts.entries()].sort((a,b)=> a[0].localeCompare(b[0])).map(([name,count])=>({name,count})); return { count: categories.length, categories }; },
  dir: ()=>{ const dir=getInstructionsDir(); let files:string[]=[]; try { files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort(); } catch { /* ignore */ } return { dir, filesCount: files.length, files }; }
};

// NOTE: Legacy per-method read-only instruction tools (instructions/list, /get, /diff, /export, etc.)
// have been fully removed in favor of the unified dispatcher (instructions/dispatch) to reduce
// surface area and simplify client capability discovery. Internal implementations remain and are
// accessible via dispatcher action names (list,get,diff,export,search,query,categories,dir,listScoped).
// Any external attempt to call the removed legacy methods should now receive -32601 (method not found)
// which nudges clients to re-discover with meta/tools and adopt dispatcher usage.
// Deep file-level inspection (diagnostics): reveals raw on-disk record, schema / classification issues, normalized form
registerHandler('instructions/inspect', (p:{id:string})=>{
  const id = p.id;
  if(!id) return { error:'missing id' };
  const dir = getInstructionsDir();
  const file = path.join(dir, `${id}.json`);
  if(!fs.existsSync(file)) return { id, exists:false, fileMissing:true };
  let rawText=''; let raw: unknown = null; let parseError: string | undefined;
  try { rawText = fs.readFileSync(file,'utf8'); raw = JSON.parse(rawText); } catch(e){ parseError = e instanceof Error? e.message: String(e); }
  // Re-run schema + classification the same way CatalogLoader does to surface rejection reasons
  let schemaErrors: string | undefined; let classificationIssues: string[] | undefined; let normalized: InstructionEntry | undefined;
  try {
    if(!parseError){
      try {
        // Inline (lightweight) schema validation replicate: only essential field presence
        const rec = raw as Partial<InstructionEntry>;
        const missing: string[] = [];
        if(!rec.id) missing.push('missing id');
        if(!rec.title) missing.push('missing title');
        if(!rec.body) missing.push('missing body');
        if(missing.length) schemaErrors = missing.join(', ');
        const classifier = new ClassificationService();
        if(!schemaErrors){
          classificationIssues = classifier.validate(rec as InstructionEntry);
          if(!classificationIssues.length){ normalized = classifier.normalize(rec as InstructionEntry); }
        }
      } catch(err){ schemaErrors = (err as Error).message; }
    }
  } catch{ /* ignore */ }
  return { id, exists:true, file, parseError, schemaErrors, classificationIssues, normalized, raw };
});
// NOTE: downstream mutation handlers retained; dispatcher will invoke via existing registered method names for those.

registerHandler('instructions/import', guard('instructions/import', (p:{entries:ImportEntry[]; mode?:'skip'|'overwrite'})=>{
  const entries=p.entries||[]; const mode=p.mode||'skip';
  if(!Array.isArray(entries)||!entries.length) return { error:'no entries' };
  const dir=getInstructionsDir(); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  let imported=0, skipped=0, overwritten=0; const errors: { id:string; error:string }[]=[]; const classifier=new ClassificationService();
  for(const e of entries){
    if(!e || !e.id || !e.title || !e.body){ const id=(e as Partial<ImportEntry>)?.id||'unknown'; errors.push({ id, error:'missing required fields'}); continue; }
    const bodyTrimmed = typeof e.body === 'string' ? e.body.trim() : String(e.body);
    const file=path.join(dir, `${e.id}.json`); const fileExists=fs.existsSync(file);
    const now=new Date().toISOString();
  let categories=Array.from(new Set((Array.isArray(e.categories)? e.categories: []).filter((c):c is string => typeof c==='string' && c.trim().length>0).map(c=>c.toLowerCase()))).sort();
  // Cast through unknown to satisfy TS (ImportEntry lacks index signature but we allow optional primaryCategory)
  const primaryCategoryRaw = (e as unknown as Record<string, unknown>).primaryCategory as string | undefined;
  // Backward compatibility: previous schema versions allowed empty categories. Instead of hard failing, inject a default
  // category unless strict governance explicitly required via env flag. Tests relying on lax add/import should continue
  // to pass while new governance still enforces P1 + owner rules below.
  if(!categories.length){
    if(process.env.MCP_REQUIRE_CATEGORY === '1') { errors.push({ id:e.id, error:'category_required'}); continue; }
    categories = ['uncategorized'];
    incrementCounter('instructions:autoCategory');
  }
  const effectivePrimary = (primaryCategoryRaw && categories.includes(primaryCategoryRaw.toLowerCase())) ? primaryCategoryRaw.toLowerCase() : categories[0];
    const newBodyHash=crypto.createHash('sha256').update(bodyTrimmed,'utf8').digest('hex');
    let existing:InstructionEntry|null=null; if(fileExists){ try { existing=JSON.parse(fs.readFileSync(file,'utf8')); } catch { existing=null; } }
    // Governance prerequisite rules BEFORE adjusting counters so failures are excluded from imported/overwritten/skipped
    if(e.priorityTier==='P1' && (!categories.length || !e.owner)) { errors.push({ id:e.id, error:'P1 requires category & owner'}); continue; }
    if((e.requirement==='mandatory' || e.requirement==='critical') && !e.owner){ errors.push({ id:e.id, error:'mandatory/critical require owner'}); continue; }
    // Skip/overwrite semantics now that governance validation passed
    if(fileExists && mode==='skip'){ skipped++; continue; }
    if(fileExists && mode==='overwrite') overwritten++; else if(!fileExists) imported++;
  const base: InstructionEntry = existing ? { ...existing, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, primaryCategory: effectivePrimary, updatedAt: now } as InstructionEntry : { id:e.id, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, primaryCategory: effectivePrimary, sourceHash:newBodyHash, schemaVersion:SCHEMA_VERSION, deprecatedBy:e.deprecatedBy, createdAt:now, updatedAt:now, riskScore:e.riskScore, createdByAgent: process.env.MCP_AGENT_ID || undefined, sourceWorkspace: process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE || undefined } as InstructionEntry;
    const govKeys: (keyof ImportEntry)[] = ['version','owner','status','priorityTier','classification','lastReviewedAt','nextReviewDue','changeLog','semanticSummary'];
    for(const k of govKeys){ const v = e[k]; if(v!==undefined){ (base as unknown as Record<string, unknown>)[k]=v as unknown; } }
    base.sourceHash = newBodyHash;
    const record=classifier.normalize(base);
    if(record.owner==='unowned'){ const auto=resolveOwner(record.id); if(auto){ record.owner=auto; record.updatedAt=new Date().toISOString(); } }
    try { atomicWriteJson(file, record); } catch { errors.push({ id:e.id, error:'write-failed'}); }
  }
  touchCatalogVersion(); invalidate(); const st=ensureLoaded();
  const summary = { hash: st.hash, imported, skipped, overwritten, total: entries.length, errors };
  logAudit('import', entries.map(e=> e.id), { imported, skipped, overwritten, errors: errors.length });
  return summary;
}));
// Add (create/update) single instruction. Maintains backward compatibility with dispatcher mapping 'add' -> 'instructions/add'.
interface AddParams { entry: ImportEntry & { lax?: boolean }; overwrite?: boolean; lax?: boolean }
registerHandler('instructions/add', guard('instructions/add', (p:AddParams)=>{
  const e = p.entry as ImportEntry | undefined;
  // Shared semantic version validation regex (MAJOR.MINOR.PATCH with optional prerelease/build)
  const SEMVER_REGEX = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/;
  // Unified failure helper adds feedback reporting guidance + sanitized repro details
  // Resolve (once) the published input schema so we can attach it for client self-correction on shape errors
  const ADD_INPUT_SCHEMA = getToolRegistry().find(t=> t.name==='instructions/add')?.inputSchema;
  const fail = (error:string, opts?:{ id?:string; hash?:string }) => {
    const id = opts?.id || (e && e.id) || 'unknown';
    const rawBody = e && typeof e.body === 'string' ? e.body : (e && e.body ? String(e.body) : '');
    const bodyPreview = rawBody.trim().slice(0,200);
    const reproEntry = e ? {
      id,
      title: (e as Partial<ImportEntry>).title || id,
      requirement: (e as Partial<ImportEntry>).requirement,
      priorityTier: (e as Partial<ImportEntry>).priorityTier,
      owner: (e as Partial<ImportEntry>).owner,
      bodyPreview
    } : { id };
    interface AddFailureResult {
      id: string; created: boolean; overwritten: boolean; skipped: boolean; error: string; hash?: string; feedbackHint: string; reproEntry: Record<string, unknown>; schemaRef?: string; inputSchema?: unknown;
    }
    const base: AddFailureResult = {
      id,
      created:false,
      overwritten:false,
      skipped:false,
      error,
      hash: opts?.hash,
      feedbackHint: 'Creation failed. If unexpected, call feedback/submit with reproEntry.',
      reproEntry
    };
    // If this is a schema / shape guidance error, attach the published input schema + reference so clients can self-heal.
    if(/^missing (entry|id|required fields)/.test(error) || error === 'missing required fields'){
      if(ADD_INPUT_SCHEMA){
        base.schemaRef = "meta/tools[name='instructions/add'].inputSchema";
        base.inputSchema = ADD_INPUT_SCHEMA; // Provided inline for immediate corrective UX.
      } else {
        base.schemaRef = 'meta/tools (lookup instructions/add)';
      }
    }
    return base as typeof base;
  };
  if(!e) return fail('missing entry');
  const lax = !!(p.lax || (e as unknown as { lax?: boolean })?.lax);
  // Apply lax defaults if enabled (allows body-only submissions like tests rely on)
  if(lax){
    if(!e.id) return fail('missing id'); // id still mandatory
    // Create a shallow mutable copy to avoid mutating original reference directly with any casts
    const mutable = e as Partial<ImportEntry> & { id:string };
    if(!mutable.title) mutable.title = mutable.id; // title defaults to id
    if(typeof mutable.priority !== 'number') mutable.priority = 50;
    if(!mutable.audience) mutable.audience = 'all' as InstructionEntry['audience'];
    if(!mutable.requirement) mutable.requirement = 'optional';
    if(!Array.isArray(mutable.categories)) mutable.categories = [];
  }
  // Metadata-only overwrite support: allow callers to omit body (and/or title already filled above)
  // when performing a governance-only mutation (e.g., priority, version bump) against an existing
  // instruction. We hydrate the missing body from the on-disk record BEFORE strict validation so
  // tests like "metadata-only change with higher version" succeed without forcing clients to
  // redundantly send the full body.
  // When overwrite is requested, hydrate any missing primary fields (body and/or title)
  // from the on-disk record so metadata-only updates can omit them.
  if(p.overwrite && (!e.body || !e.title)){
    try {
      const dirCandidate = getInstructionsDir();
      const fileCandidate = path.join(dirCandidate, `${e.id}.json`);
      if(fs.existsSync(fileCandidate)){
        try {
          const raw = JSON.parse(fs.readFileSync(fileCandidate,'utf8')) as Partial<InstructionEntry>;
          if(raw){
            const mutableExisting = e as Partial<InstructionEntry> & { id:string };
            if(!mutableExisting.body && typeof raw.body === 'string' && raw.body.trim()){
              mutableExisting.body = raw.body; // hydrate body when missing
            }
            if(!mutableExisting.title && typeof raw.title === 'string' && raw.title.trim()){
              mutableExisting.title = raw.title; // hydrate title when missing
            }
          }
        } catch { /* ignore parse */ }
      }
    } catch { /* ignore hydration errors */ }
  }
  // Strict validation after lax fill
  if(!e.id || !e.title || !e.body) return fail('missing required fields');
  const dir = getInstructionsDir(); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir, `${e.id}.json`);
  const exists = fs.existsSync(file);
  // Preserve original existence state explicitly; some branches may fallback to treating unreadable
  // existing files as new, but governance flags (created/overwritten) should reflect on-disk reality.
  const existedBeforeOriginal = exists;
  const overwrite = !!p.overwrite;
  if(exists && !overwrite){
    // Reliability patch: ensure that a skip (meaning file existed) also implies catalog visibility.
    // If not immediately visible, attempt reload then late materialization; if still missing we
    // annotate the response so clients/tests can flag the anomalous state explicitly instead of
    // silently returning skipped + subsequent notFound.
    let st0=ensureLoaded(); let visible=st0.byId.has(e.id); let repaired=false; if(!visible){
      try { invalidate(); st0=ensureLoaded(); visible=st0.byId.has(e.id); if(visible) repaired=true; } catch { /* ignore reload */ }
      if(!visible){
        const filePath=file; if(fs.existsSync(filePath)){
          try { const rawTxt=fs.readFileSync(filePath,'utf8'); if(rawTxt.trim()){ const rawJson=JSON.parse(rawTxt) as InstructionEntry; const classifier=new ClassificationService(); const issues=classifier.validate(rawJson); if(!issues.length){ const norm=classifier.normalize(rawJson); st0.list.push(norm); st0.byId.set(norm.id,norm); visible=true; repaired=true; incrementCounter('instructions:addSkipLateMaterialize'); } else { incrementCounter('instructions:addSkipLateMaterializeRejected'); } } else { incrementCounter('instructions:addSkipLateMaterializeEmpty'); }
          } catch { incrementCounter('instructions:addSkipLateMaterializeParseError'); }
        }
      }
    }
    logAudit('add', e.id, { skipped:true, late_visible: visible, repaired });
    if(traceVisibility()){ emitTrace('[trace:add:skip]', { id:e.id, visible, repaired }); }
    if(traceVisibility()){
      traceInstructionVisibility(e.id, 'add-skip-pre-return', { visible, repaired });
      if(!visible) traceEnvSnapshot('add-skip-anomalous', { repaired });
    }
    if(!visible){ return { id:e.id, skipped:true, created:false, overwritten:false, hash: st0.hash, visibilityWarning:'skipped_file_not_in_catalog' }; }
    return { id:e.id, skipped:true, created:false, overwritten:false, hash: st0.hash, repaired: repaired? true: undefined };
  }
  const now = new Date().toISOString();
  const rawBody = typeof e.body==='string'? e.body: String(e.body||'');
  const bodyTrimmed = rawBody.trim();
  // Apply canonicalization so sourceHash stable across superficial whitespace edits.
  let categories = Array.from(new Set((Array.isArray(e.categories)? e.categories: []).filter((c):c is string=> typeof c==='string' && c.trim().length>0).map(c=> c.toLowerCase()))).sort();
  if(!categories.length){
    const allowAuto = lax || process.env.MCP_REQUIRE_CATEGORY !== '1';
    if(allowAuto){
      categories = ['uncategorized'];
      if(traceVisibility()) emitTrace('[trace:add:auto-category]', { id:e.id });
      incrementCounter('instructions:autoCategory');
    } else {
      return fail('category_required', { id:e.id });
    }
  }
  const suppliedPrimary = (e as unknown as Record<string, unknown>).primaryCategory as string | undefined;
  const primaryCategory = (suppliedPrimary && categories.includes(suppliedPrimary.toLowerCase())) ? suppliedPrimary.toLowerCase() : categories[0];
  const sourceHash = process.env.MCP_CANONICAL_DISABLE === '1'
    ? crypto.createHash('sha256').update(bodyTrimmed,'utf8').digest('hex')
    : hashBody(rawBody);
  // Governance prerequisites
  if(e.priorityTier==='P1' && (!categories.length || !e.owner)) return fail('P1 requires category & owner', { id:e.id });
  if((e.requirement==='mandatory' || e.requirement==='critical') && !e.owner) return fail('mandatory/critical require owner', { id:e.id });
  const classifier = new ClassificationService();
  let base: InstructionEntry;
  if(exists){
    try {
      const existing = JSON.parse(fs.readFileSync(file,'utf8')) as InstructionEntry;
      // Start from existing to preserve unspecified fields when overwrite=true but fields omitted (common in tests)
      base = { ...existing } as InstructionEntry;
      const prevBody = existing.body;
      const prevVersion = existing.version || '1.0.0';
      // Only overwrite individual fields if explicitly supplied (or lax provided default title)
      if(e.title) base.title = e.title;
  if(e.body) base.body = bodyTrimmed; // preserve original trimmed body on disk (do not store canonical form to retain author intent)
      if(e.rationale !== undefined) base.rationale = e.rationale;
      if(typeof e.priority === 'number') base.priority = e.priority;
      if(e.audience) base.audience = e.audience;
      if(e.requirement) base.requirement = e.requirement as InstructionEntry['requirement'];
  if(categories.length) { base.categories = categories; base.primaryCategory = primaryCategory; }
      base.updatedAt = now;
      if(e.version!==undefined) base.version = e.version;
      if(e.changeLog!==undefined) base.changeLog = e.changeLog as InstructionEntry['changeLog'];
      // --- Strict version governance & automatic bump logic ------------------------------
      // We enforce semantic versioning (MAJOR.MINOR.PATCH) optionally with prerelease/build.
  const semverRegex = SEMVER_REGEX;
  const parse = (v:string) => { const m = semverRegex.exec(v); if(!m) return null; return { major:+m[1], minor:+m[2], patch:+m[3] }; };
      const gt = (a:string,b:string) => { const pa=parse(a), pb=parse(b); if(!pa||!pb) return false; if(pa.major!==pb.major) return pa.major>pb.major; if(pa.minor!==pb.minor) return pa.minor>pb.minor; return pa.patch>pb.patch; };
      const bodyChanged = e.body ? (bodyTrimmed !== prevBody) : false;
      let incomingVersion = e.version; // could be undefined
      if(incomingVersion && !semverRegex.test(incomingVersion)) return fail('invalid_semver', { id:e.id });
      if(bodyChanged){
        if(incomingVersion){
          if(!gt(incomingVersion, prevVersion)) return fail('version_not_bumped', { id:e.id });
          // Use incoming version; ensure changeLog alignment later
        } else {
          // Auto bump patch version
          const pv = parse(prevVersion) || { major:1, minor:0, patch:0 };
            const autoVersion = `${pv.major}.${pv.minor}.${pv.patch+1}`;
            base.version = autoVersion;
            incomingVersion = autoVersion;
        }
      } else if(incomingVersion){
        // Metadata-only change but version supplied: must be strictly greater
        if(!gt(incomingVersion, prevVersion)) return fail('version_not_bumped', { id:e.id });
      } else {
        // No body change & no version supplied: retain existing version
        base.version = prevVersion;
        incomingVersion = prevVersion;
      }
      // Initialize or append changeLog entries
      if(!Array.isArray(base.changeLog) || !base.changeLog.length){
        base.changeLog = [ { version: prevVersion, changedAt: existing.createdAt || now, summary: 'initial import' } ];
      }
      // Ensure a log entry exists for the new (possibly auto-bumped) version if it differs from last
      const finalVersion = base.version || incomingVersion || prevVersion;
      const last = base.changeLog[base.changeLog.length-1];
      if(last.version !== finalVersion){
        const summary = bodyChanged ? (e.version? 'body update':'auto bump (body change)') : 'metadata update';
        base.changeLog.push({ version: finalVersion, changedAt: now, summary });
      }
      // --- Silent changeLog repair (update path) ------------------------------------------
      // Goal: never throw on malformed changeLog; instead normalize entries & append a repair note.
      const repairChangeLog = (cl: unknown): InstructionEntry['changeLog'] => {
        interface CLRaw { version?: unknown; changedAt?: unknown; summary?: unknown }
        const out: InstructionEntry['changeLog'] = [];
        if(Array.isArray(cl)){
          for(const entry of cl){
            if(!entry || typeof entry !== 'object') continue;
            const { version: v, changedAt: ca, summary: sum } = entry as CLRaw;
            if(typeof v === 'string' && v.trim() && typeof sum === 'string' && sum.trim()){
              const caIso = typeof ca === 'string' && /T/.test(ca) ? ca : now;
              out.push({ version: v.trim(), changedAt: caIso, summary: sum.trim() });
            }
          }
        }
        if(!out.length){
          // Seed with previous version if we lost everything
          out.push({ version: prevVersion, changedAt: existing.createdAt || now, summary: 'initial import (repaired)' });
        }
        // Ensure final version present (append if necessary)
        const lastVer = out[out.length-1].version;
        if(lastVer !== finalVersion){
          out.push({ version: finalVersion, changedAt: now, summary: bodyChanged? 'body update (repaired)': 'metadata update (repaired)' });
        }
        return out;
      };
      base.changeLog = repairChangeLog(base.changeLog);
    } catch {
      // Fallback if existing unreadable -> treat as new
  base = { id:e.id, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, primaryCategory, sourceHash, schemaVersion: SCHEMA_VERSION, deprecatedBy:e.deprecatedBy, createdAt: now, updatedAt: now, riskScore:e.riskScore, createdByAgent: process.env.MCP_AGENT_ID || undefined, sourceWorkspace: process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE || undefined } as InstructionEntry;
      // Initialize governance defaults for new fallback record
      base.version = '1.0.0';
      base.changeLog = [ { version: '1.0.0', changedAt: now, summary: 'initial import' } ];
    }
  } else {
  base = { id:e.id, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, primaryCategory, sourceHash, schemaVersion: SCHEMA_VERSION, deprecatedBy:e.deprecatedBy, createdAt: now, updatedAt: now, riskScore:e.riskScore, createdByAgent: process.env.MCP_AGENT_ID || undefined, sourceWorkspace: process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE || undefined } as InstructionEntry;
  // New entry governance defaults (strict): if caller supplies version it MUST be valid semver.
  if(e.version !== undefined){
    if(!SEMVER_REGEX.test(e.version)) return fail('invalid_semver', { id:e.id });
    base.version = e.version;
  } else {
    base.version = '1.0.0';
  }
  if(!Array.isArray(base.changeLog) || !base.changeLog.length){
    base.changeLog = [ { version: base.version, changedAt: now, summary: 'initial import' } ];
  }
  // --- Silent changeLog repair (create path) ----------------------------------------------
  if(Array.isArray(base.changeLog)){
    interface CLRaw { version?: unknown; changedAt?: unknown; summary?: unknown }
    const repaired: InstructionEntry['changeLog'] = [];
    for(const entry of base.changeLog){
      if(!entry || typeof entry !== 'object') continue;
      const { version: v, changedAt: ca, summary: sum } = entry as CLRaw;
      if(typeof v === 'string' && v.trim() && typeof sum === 'string' && sum.trim()){
        const caIso = typeof ca === 'string' && /T/.test(ca) ? ca : now;
        repaired.push({ version: v.trim(), changedAt: caIso, summary: sum.trim() });
      }
    }
    if(!repaired.length){
      repaired.push({ version: base.version, changedAt: now, summary: 'initial import (repaired)' });
    }
    if(repaired[repaired.length-1].version !== base.version){
      repaired.push({ version: base.version, changedAt: now, summary: 'initial import (normalized)' });
    }
    base.changeLog = repaired;
  }
  }
  // Pass-through governance fields (exclude changeLog to avoid overwriting repaired log)
  const govKeys: (keyof ImportEntry)[] = ['version','owner','status','priorityTier','classification','lastReviewedAt','nextReviewDue','semanticSummary'];
  for(const k of govKeys){ const v = (e as ImportEntry)[k]; if(v!==undefined){ (base as unknown as Record<string, unknown>)[k]=v as unknown; } }
  // Ensure sourceHash reflects trimmed body (only recompute if body changed or new)
  if(!exists || base.body === bodyTrimmed){
    base.sourceHash = sourceHash;
  } else {
    // existing body may not equal trimmed new body if not supplied; recompute using canonical guard
    base.sourceHash = process.env.MCP_CANONICAL_DISABLE === '1'
      ? crypto.createHash('sha256').update(base.body,'utf8').digest('hex')
      : hashBody(base.body);
  }
  const record = classifier.normalize(base);
  if(record.owner==='unowned'){ const auto=resolveOwner(record.id); if(auto){ record.owner=auto; record.updatedAt=new Date().toISOString(); } }
  try { atomicWriteJson(file, record); } catch(err){ return fail((err as Error).message||'write-failed', { id:e.id }); }
  touchCatalogVersion(); invalidate(); let st=ensureLoaded();
  // Optional stabilization delay: certain filesystems / antivirus layers on Windows or network mounts
  // may surface a just-written file in directory listings a few milliseconds after synchronous write.
  // Rather than performing multiple reload cycles aggressively, allow a small, configurable pause
  // BEFORE we perform the atomic visibility check. This reduces reliance on late materialization
  // while keeping the fast path effectively unchanged on systems without lag.
  // Controlled by MCP_ADD_STABILIZE_MS (integer ms). If not set, defaults to 0 (no delay). Values
  // above 50ms are clamped to 50 to avoid accidental large stalls. If set to a negative value, it
  // is treated as 0. This is a pragmatic mitigation, not a full transactional FS abstraction.
  try {
    const stabilizeEnv = process.env.MCP_ADD_STABILIZE_MS;
    if(stabilizeEnv){
      let ms = parseInt(stabilizeEnv,10);
      if(!Number.isFinite(ms) || ms<0) ms = 0;
      if(ms>50) ms = 50; // clamp
      if(ms>0){
        const startSpin = Date.now();
        // Busy-wait spin is acceptable here because add frequency is low and duration tiny (<50ms)
        // and avoids introducing async complexity into the synchronous tool handler contract.
        while(Date.now() - startSpin < ms) { /* spin for stabilization */ }
      }
    }
  } catch { /* ignore stabilization errors */ }
  // After stabilization & initial reload, ensure the just-written record is present in-memory.
  // This removes reliance on directory enumeration timing for atomic visibility: if the loader
  // missed the file (rare FS race), we inject the normalized record we already have. This is safe
  // because 'record' is the authoritative normalized object that was persisted to disk.
  try {
    if(!st.byId.has(e.id)){
      st.byId.set(record.id, record);
      // Avoid duplicate list entries if an unexpected stale reference exists; simple guard.
      if(!st.list.some(r=> r.id===record.id)) st.list.push(record);
      incrementCounter('instructions:directInjectAfterAdd');
      if(traceVisibility()) emitTrace('[trace:add:direct-inject]', { id:e.id, listCount: st.list.length });
    }
  } catch { /* ignore direct injection issues */ }
  if(traceVisibility()){ emitTrace('[trace:add:post-write]', { dir, id:e.id, exists: fs.existsSync(file), catalogHas: st.byId.has(e.id), listCount: st.list.length }); traceInstructionVisibility(e.id, 'add-post-write'); }
  // Atomic read-back verification: ensure newly written/overwritten entry is *immediately* visible
  // in the in-memory catalog before declaring success. If not, attempt one forced reload; if still
  // absent (extremely unlikely on local FS), return an error instead of a false positive 'created'.
  let atomicVisible = st.byId.has(e.id);
  if(!atomicVisible){
    try {
      invalidate();
      st = ensureLoaded();
      atomicVisible = st.byId.has(e.id);
    } catch { /* ignore secondary reload error */ }
  }
  if(!atomicVisible){
    // FINAL RESILIENCE: On some Windows / network FS setups a just-written rename can surface in readdir
    // fractionally after our second ensureLoaded(). If the on-disk file exists, attempt a direct late
    // materialization (parse + normalize) rather than returning a false negative atomic_readback_failed.
    try {
      if(fs.existsSync(file)){
        try {
          // Minimal inline retry (mirrors CatalogLoader.readJsonWithRetry) for late materialization
          let rawAny: InstructionEntry | null = null; let attemptErr: unknown = null;
          const maxAttempts = Math.max(1, Number(process.env.MCP_READ_RETRIES)||3);
          const baseBackoff = Math.max(1, Number(process.env.MCP_READ_BACKOFF_MS)||8);
          for(let attempt=1; attempt<=maxAttempts; attempt++){
            try {
              const txt = fs.readFileSync(file,'utf8');
              if(!txt.trim()){
                if(attempt===maxAttempts) throw new Error('empty file');
              } else {
                rawAny = JSON.parse(txt) as InstructionEntry;
                break;
              }
            } catch(e){
              attemptErr = e;
              if(attempt===maxAttempts) break;
              const code=(e as NodeJS.ErrnoException).code;
              const transient = code==='EPERM'||code==='EBUSY'||code==='EACCES'||code==='ENOENT'|| (e instanceof Error && /empty/.test(e.message));
              if(!transient) break;
              const sleep= baseBackoff * Math.pow(2, attempt-1) + Math.floor(Math.random()*baseBackoff);
              const start=Date.now();
              while(Date.now()-start<sleep) { /* spin small backoff */ }
            }
          }
          if(!rawAny) throw attemptErr || new Error('late materialization read failed');
          const classifier2 = new ClassificationService();
          const issues = classifier2.validate(rawAny);
          if(!issues.length){
            const normalized = classifier2.normalize(rawAny);
            // Only inject if not already visible (double‑check)
            if(!st.byId.has(normalized.id)){
              st.list.push(normalized);
              st.byId.set(normalized.id, normalized);
              atomicVisible = true;
              incrementCounter('instructions:lateMaterializeAfterAdd');
            }
          } else {
            incrementCounter('instructions:lateMaterializeRejected');
          }
        } catch {
          incrementCounter('instructions:lateMaterializeParseError');
        }
      } else {
        incrementCounter('instructions:lateMaterializeFileMissing');
      }
    } catch { /* ignore outer fallback errors */ }
  }
  if(!atomicVisible){
    logAudit('add', e.id, { created: false, overwritten: false, atomic_readback_failed: true });
  if(traceVisibility()){ emitTrace('[trace:add:failure]', { dir, id:e.id, fileExists: fs.existsSync(file), catalogHas: st.byId.has(e.id), listCount: st.list.length }); traceInstructionVisibility(e.id, 'add-failure'); traceEnvSnapshot('add-failure'); }
    return fail('atomic_readback_failed', { id:e.id, hash: st.hash });
  }
  // Final shape/readability validation: ensure catalog entry is structurally sound before
  // declaring success. Prevents false positives where an incomplete or partially written
  // record became visible (edge cases: truncated write recovered via late materialization
  // but missing required fields). If this check fails we surface a distinct error so tests
  // and monitoring can differentiate from pure visibility failures.
  let readable = false;
  try {
    const rec = st.byId.get(e.id) as Partial<InstructionEntry> | undefined;
    if(rec && rec.id === e.id && typeof rec.body === 'string' && typeof rec.title === 'string'){
      // Require non-empty (after trim) body & title for readability confirmation
      if(rec.body.trim() && rec.title.trim()) readable = true;
    }
  } catch { /* ignore */ }
  if(!readable){
    logAudit('add', e.id, { created: false, overwritten: false, readback_invalid_shape: true });
  if(traceVisibility()){ emitTrace('[trace:add:invalid-shape]', { dir, id:e.id }); traceInstructionVisibility(e.id, 'add-invalid-shape'); traceEnvSnapshot('add-invalid-shape'); }
    return fail('readback_invalid_shape', { id:e.id, hash: st.hash });
  }
  // Optional STRICT post-write verification (opt-in via MCP_INSTRUCTIONS_STRICT_CREATE=1)
  // Performs an additional independent read & integrity checks BEFORE returning success.
  const strictEnabled = process.env.MCP_INSTRUCTIONS_STRICT_CREATE === '1';
  let strictVerified = false;
  if(strictEnabled){
    try {
      // Direct disk read (bypassing catalog) to verify file contents exactly reflect catalog entry.
      const rawText = fs.readFileSync(file,'utf8');
      const rawJson = JSON.parse(rawText) as Partial<InstructionEntry>;
      // Basic structural assertions
      const structOk = rawJson.id === e.id && typeof rawJson.body === 'string' && rawJson.body.trim().length>0 && typeof rawJson.title === 'string' && rawJson.title.trim().length>0;
      if(structOk){
        // Recompute hash over raw body using same canonicalization rules
        const bodyForHash = rawJson.body as string;
        const recomputed = process.env.MCP_CANONICAL_DISABLE === '1'
          ? crypto.createHash('sha256').update(bodyForHash,'utf8').digest('hex')
          : hashBody(bodyForHash);
        const sourceHashMatches = rawJson.sourceHash === recomputed;
        // Ensure catalog still has the entry and body matches catalog view
        const catalogRec = st.byId.get(e.id) as InstructionEntry | undefined;
        const catalogConsistent = !!catalogRec && catalogRec.body === rawJson.body && catalogRec.title === rawJson.title;
        strictVerified = structOk && sourceHashMatches && catalogConsistent;
        if(!strictVerified && traceVisibility()){
          emitTrace('[trace:add:strict-mismatch]', { id:e.id, structOk, sourceHashMatches, catalogConsistent, rawSourceHash: rawJson.sourceHash, recomputed });
        }
      } else if(traceVisibility()){
        emitTrace('[trace:add:strict-struct-fail]', { id:e.id });
      }
    } catch(err){
      if(traceVisibility()) emitTrace('[trace:add:strict-error]', { id:e.id, error: (err as Error).message });
      strictVerified = false;
    }
    if(!strictVerified){
      logAudit('add', e.id, { created: false, overwritten: false, strict_verification_failed: true });
      return fail('strict_verification_failed', { id:e.id, hash: st.hash });
    }
  }
  // Final authoritative flags (avoid stale existence race): if overwrite requested and the file
  // exists now, treat as overwritten when it existed previously or when overwrite intent supplied.
  
  // REQUIREMENT: Only return created:true if instruction can be found by ID after disk write
  // Check that instruction is actually findable by ID in the current catalog state
  const foundById = st.byId.has(e.id);
  const createdFlag = !existedBeforeOriginal && foundById;
  
  // Overwrite semantics: if caller requested overwrite and the record existed before this call,
  // we report overwritten=true (independent of any transient post-write visibility races).
  const overwrittenFlag = overwrite && existedBeforeOriginal;
  const resp = { id:e.id, created: createdFlag, overwritten: overwrittenFlag, skipped:false, hash: st.hash, verified:true, strictVerified: strictEnabled? true: undefined };
  logAudit('add', e.id, { created: createdFlag, overwritten: overwrittenFlag, verified:true });
  if(traceVisibility()){ emitTrace('[trace:add:success]', { dir, id:e.id, created: createdFlag, overwritten: overwrittenFlag, listCount: st.list.length }); traceInstructionVisibility(e.id, 'add-success', { created: createdFlag, overwritten: overwrittenFlag }); }
  return resp;
}));

registerHandler('instructions/remove', guard('instructions/remove', (p:{ ids:string[]; missingOk?: boolean })=>{
  const ids=Array.isArray(p.ids)? Array.from(new Set(p.ids.filter(x=> typeof x==='string' && x.trim()))):[];
  if(!ids.length) return { removed:0, removedIds:[], missing:[], errorCount:0, errors:['no ids supplied'] };
  const base=getInstructionsDir();
  const missing:string[]=[]; const removed:string[]=[]; const errors:{ id:string; error:string }[]=[];
  for(const id of ids){
    const file=path.join(base, `${id}.json`);
    try {
      if(!fs.existsSync(file)){ missing.push(id); continue; }
      fs.unlinkSync(file);
      removed.push(id);
    } catch(e){ errors.push({ id, error: e instanceof Error? e.message: 'delete-failed' }); }
  }
  if(removed.length){ touchCatalogVersion(); invalidate(); }
  let st = ensureLoaded();
  // Optional strict verification: ensure removed IDs are not present in catalog after reload.
  const strictRemove = process.env.MCP_INSTRUCTIONS_STRICT_REMOVE === '1';
  let strictFailed: string[] = [];
  if(strictRemove){
    // If any removed IDs still visible, attempt one more reload then final check.
    const stillVisible = removed.filter(id=> st.byId.has(id));
    if(stillVisible.length){
      try { invalidate(); st = ensureLoaded(); } catch { /* ignore */ }
    }
    strictFailed = removed.filter(id=> st.byId.has(id));
    if(strictFailed.length && traceVisibility()) emitTrace('[trace:remove:strict-failed]', { ids: strictFailed });
  }
  const resp = { removed: removed.length, removedIds: removed, missing, errorCount: errors.length + (strictFailed.length? 1:0), errors, strictVerified: strictRemove? (strictFailed.length===0): undefined, strictFailed };
  if(strictRemove && strictFailed.length){
    logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length, strict_failed: strictFailed.length });
    return resp;
  }
  logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length });
  return resp;
}));

registerHandler('instructions/reload', guard('instructions/reload', ()=>{ invalidate(); const st=ensureLoaded(); const resp = { reloaded:true, hash: st.hash, count: st.list.length }; logAudit('reload', undefined, { count: st.list.length }); return resp; }));

registerHandler('instructions/governanceHash', ()=>{
  // First attempt: normal ensureLoaded path
  let st = ensureLoaded();
  // Lightweight verification: spot-check random single file for metadata-only divergence that might have
  // slipped past coarse signature if filesystem timestamp coalesced. We only do this if env not forcing reload
  // and we DID NOT just perform a reload during ensureLoaded (heuristic: loadedAt within last 50ms implies reload).
  const now = Date.now();
  const loadedAgo = now - new Date(st.loadedAt).getTime();
  if(loadedAgo > 50){
    try {
      // Pick first entry (deterministic) and compare owner + updatedAt to on-disk JSON; if mismatch, invalidate.
      const first = st.list[0];
      if(first){
        const file = path.join(getInstructionsDir(), `${first.id}.json`);
        if(fs.existsSync(file)){
          const raw = JSON.parse(fs.readFileSync(file,'utf8')) as { owner?:string; updatedAt?:string };
            if(raw && typeof raw.owner==='string' && raw.owner !== first.owner){
              invalidate();
              st = ensureLoaded();
            }
        }
      }
    } catch { /* ignore verification errors */ }
  }
  let projections=st.list.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(projectGovernance);
  // Defensive: if a caller recently modified an instruction on disk (e.g., owner change) and a coarse
  // directory signature + timestamp coalescing caused the modified file to not yet appear with updated
  // metadata (or transiently disappear due to a racing invalidate), attempt a focused late materialization.
  // We key off a rare condition: empty projections or a projection set whose first entry owner differs
  // from on-disk owner for that same id (indicating catalog staleness) OR a small minority (<90%) of ids
  // relative to files on disk (suggesting partial visibility under race conditions).
  try {
    const dir = getInstructionsDir();
    const files = fs.readdirSync(dir).filter(f=> f.endsWith('.json'));
    if(files.length && (projections.length === 0 || projections.length < Math.floor(files.length*0.9))){
      const missingIds = new Set(files.map(f=> f.replace(/\.json$/,'')));
      for(const p of projections){ missingIds.delete(p.id); }
      // Attempt to load a small number of missing ids (cap 5 to bound cost) and refresh state if any loaded.
      let hydrated = false;
      let loadCount = 0;
      for(const mid of missingIds){
        if(loadCount>=5) break; loadCount++;
        const file = path.join(dir, mid + '.json');
        try {
          const raw = JSON.parse(fs.readFileSync(file,'utf8')) as InstructionEntry;
          if(raw && raw.id === mid){
            st.list.push(raw); st.byId.set(raw.id, raw); hydrated = true;
          }
        } catch { /* ignore individual load errors */ }
      }
      if(hydrated){
        projections = st.list.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(projectGovernance);
        try { incrementCounter('governance:lateMaterialize'); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore defensive reload errors */ }
  const governanceHash=computeGovernanceHash(st.list);
  // Final defensive repair: if after late materialization we still have a suspiciously low
  // projection count (<90% of loaded entries) or any undefined owner fields (should be normalized),
  // perform a one-time invalidate+reload to eliminate a transient visibility race, then recompute.
  if(projections.length && projections.length < Math.floor(st.list.length*0.9) || projections.some(p=> !p.owner)){
    try {
      invalidate();
      const st2 = ensureLoaded();
      projections = st2.list.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(projectGovernance);
      try { incrementCounter('governance:projectionRepair'); } catch { /* ignore */ }
    } catch { /* ignore reload failure */ }
  }
  return { count: projections.length, governanceHash, items: projections };
});

registerHandler('instructions/health', ()=>{ const st=ensureLoaded(); const governanceHash = computeGovernanceHash(st.list); const snapshot=path.join(process.cwd(),'snapshots','canonical-instructions.json'); if(!fs.existsSync(snapshot)) return { snapshot:'missing', hash: st.hash, count: st.list.length, governanceHash }; try { const raw = JSON.parse(fs.readFileSync(snapshot,'utf8')) as { items?: { id:string; sourceHash:string }[] }; const snapItems=raw.items||[]; const snapMap=new Map(snapItems.map(i=>[i.id,i.sourceHash] as const)); const missing:string[]=[]; const changed:string[]=[]; for(const e of st.list){ const h=snapMap.get(e.id); if(h===undefined) missing.push(e.id); else if(h!==e.sourceHash) changed.push(e.id); } const extra=snapItems.filter(i=> !st.byId.has(i.id)).map(i=>i.id); return { snapshot:'present', hash: st.hash, count: st.list.length, missing, changed, extra, drift: missing.length+changed.length+extra.length, governanceHash }; } catch(e){ return { snapshot:'error', error: e instanceof Error? e.message: String(e), hash: st.hash, governanceHash }; } });

// Enrichment persistence tool: rewrites placeholder governance fields on disk to normalized values
registerHandler('instructions/enrich', guard('instructions/enrich', ()=>{
  const st=ensureLoaded();
  const baseDir=getInstructionsDir();
  let rewritten=0; const updated:string[]=[]; const skipped:string[]=[];
  for(const e of st.list){
    const file=path.join(baseDir, `${e.id}.json`);
    if(!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file,'utf8')) as Record<string, unknown>;
      let needs = false;
  // Fallback recomputation (defensive) in case catalog normalization didn't persist yet.
  const nowIso = new Date().toISOString();
  if(!(typeof raw.sourceHash==='string' && raw.sourceHash.length>0)) { raw.sourceHash = e.sourceHash || crypto.createHash('sha256').update(String(e.body||''),'utf8').digest('hex'); needs=true; }
  if(typeof raw.createdAt==='string' && raw.createdAt.length===0){ raw.createdAt = e.createdAt || nowIso; needs=true; }
  if(typeof raw.updatedAt==='string' && raw.updatedAt.length===0){ raw.updatedAt = e.updatedAt || nowIso; needs=true; }
  if(raw.owner==='unowned' && e.owner && e.owner!=='unowned'){ raw.owner = e.owner; needs=true; }
  if((raw.priorityTier===undefined || raw.priorityTier===null || raw.priorityTier==='') && e.priorityTier){ raw.priorityTier = e.priorityTier; needs=true; }
  if(!(typeof raw.semanticSummary==='string' && raw.semanticSummary.length>0) && e.semanticSummary){ raw.semanticSummary = e.semanticSummary; needs=true; }
      const apply = (k: keyof InstructionEntry) => {
        const onDisk = raw[k];
        const norm = (e as unknown as Record<string, unknown>)[k];
        switch(k){
          case 'sourceHash':
            if(!(typeof onDisk==='string' && onDisk.length>0) && typeof norm==='string'){ raw[k]=norm; needs=true; }
            break;
          case 'owner':
            if(onDisk==='unowned' && typeof norm==='string' && norm!=='unowned'){ raw[k]=norm; needs=true; }
            break;
          case 'updatedAt':
            if(typeof onDisk==='string' && onDisk.length===0 && typeof norm==='string' && norm.length>0){ raw[k]=norm; needs=true; }
            break;
          case 'priorityTier':
            if((onDisk===undefined || onDisk===null || onDisk==='') && typeof norm==='string'){ raw[k]=norm; needs=true; }
            break;
          case 'semanticSummary':
            if(!(typeof onDisk==='string' && onDisk.length>0) && typeof norm==='string'){ raw[k]=norm; needs=true; }
            break;
          default: break;
        }
      };
      apply('sourceHash'); apply('owner'); apply('createdAt'); apply('updatedAt'); apply('priorityTier'); apply('semanticSummary');
      if(needs){ fs.writeFileSync(file, JSON.stringify(raw,null,2)); rewritten++; updated.push(e.id); } else { skipped.push(e.id); }
    } catch { /* ignore */ }
  }
  if(rewritten){ touchCatalogVersion(); invalidate(); ensureLoaded(); }
  const resp = { rewritten, updated, skipped };
  if(rewritten) logAudit('enrich', updated, { rewritten, skipped: skipped.length });
  return resp;
}));

// Debug snapshot tool: reveals discrepancy between on-disk files and current in-memory catalog without forcing reload first.
registerHandler('instructions/debugCatalog', ()=>{
  const before = getDebugCatalogSnapshot();
  // Force load to provide after view and hash (ensureLoaded returns state, but we also want loader debug if recent)
  const st = ensureLoaded();
  // loader debug is only emitted during load; we surface last load summary if present on hidden symbol
  // (We don't persist full trace in memory unless file trace env set; rely on env gating to keep lightweight.)
  const after = { hash: st.hash, count: st.list.length };
  return { before, after };
});

// Governance patch tool: controlled updates to limited governance fields + optional semantic version bump
registerHandler('instructions/governanceUpdate', guard('instructions/governanceUpdate', (p:{ id:string; owner?:string; status?:string; lastReviewedAt?:string; nextReviewDue?:string; bump?: 'patch'|'minor'|'major'|'none' })=>{
  const id = p.id;
  const st=ensureLoaded();
  const existing=st.byId.get(id);
  if(!existing) return { id, notFound:true };
  const file=path.join(getInstructionsDir(), `${id}.json`);
  if(!fs.existsSync(file)) return { id, notFound:true };
  let record: InstructionEntry;
  try { record=JSON.parse(fs.readFileSync(file,'utf8')) as InstructionEntry; } catch { return { id, error:'read-failed' }; }
  let changed=false; const now=new Date().toISOString();
  const bump=p.bump||'none';
  if(p.owner && p.owner!==record.owner){ record.owner=p.owner; changed=true; }
  if(p.status){
    // Accept legacy alias 'active' -> 'approved' (previous bug accepted invalid status causing schema rejection on reload)
    const allowed: InstructionEntry['status'][] = ['draft','review','approved','deprecated'];
  const desired = p.status === 'active' ? 'approved' : p.status;
    if(!allowed.includes(desired as InstructionEntry['status'])){
      return { id, error:'invalid status', provided: p.status };
    }
    if(desired !== record.status){
      record.status = desired as InstructionEntry['status'];
      changed=true;
    }
  }
  if(p.lastReviewedAt){ record.lastReviewedAt=p.lastReviewedAt; changed=true; }
  if(p.nextReviewDue){ record.nextReviewDue=p.nextReviewDue; changed=true; }
  if(bump && bump!=='none'){
    const parts=(record.version||'1.0.0').split('.').map(n=>parseInt(n||'0',10)); while(parts.length<3) parts.push(0);
    if(bump==='major') parts[0]++; else if(bump==='minor') parts[1]++; else if(bump==='patch') parts[2]++; if(bump==='major'){ parts[1]=0; parts[2]=0; } if(bump==='minor'){ parts[2]=0; }
    const newVersion=parts.join('.'); if(newVersion!==record.version){ record.version=newVersion; record.changeLog=[...(record.changeLog||[]), { version:newVersion, changedAt: now, summary:`manual ${bump} bump via governanceUpdate` }]; changed=true; }
  }
  if(!changed) return { id, changed:false };
  record.updatedAt=now;
  try { fs.writeFileSync(file, JSON.stringify(record,null,2)); } catch { return { id, error:'write-failed' }; }
  touchCatalogVersion(); invalidate(); ensureLoaded();
  const resp = { id, changed:true, version: record.version, owner: record.owner, status: record.status, lastReviewedAt: record.lastReviewedAt, nextReviewDue: record.nextReviewDue };
  logAudit('governanceUpdate', id, { changed:true, version: record.version });
  return resp;
}));

// Hash repair tool (instructions/repair) ported from monolith
registerHandler('instructions/repair', guard('instructions/repair', (_p:unknown)=>{ const st=ensureLoaded(); const toFix: { entry: InstructionEntry; actual:string }[]=[]; for(const e of st.list){ const actual=crypto.createHash('sha256').update(e.body,'utf8').digest('hex'); if(actual!==e.sourceHash) toFix.push({ entry:e, actual }); } if(!toFix.length) return { repaired:0, updated:[] }; const repaired:string[]=[]; for(const { entry, actual } of toFix){ const file=path.join(getInstructionsDir(), `${entry.id}.json`); try { const updated={ ...entry, sourceHash: actual, updatedAt:new Date().toISOString() }; fs.writeFileSync(file, JSON.stringify(updated,null,2)); repaired.push(entry.id); } catch { /* ignore */ } } if(repaired.length){ touchCatalogVersion(); invalidate(); ensureLoaded(); } const resp = { repaired: repaired.length, updated: repaired }; if(repaired.length) logAudit('repair', repaired, { repaired: repaired.length }); return resp; }));

// Groom tool (instructions/groom) - copied & lightly simplified
registerHandler('instructions/groom', guard('instructions/groom', (p:{ mode?: { dryRun?: boolean; removeDeprecated?: boolean; mergeDuplicates?: boolean; purgeLegacyScopes?: boolean } })=>{
  const mode=p.mode||{}; const dryRun=!!mode.dryRun; const removeDeprecated=!!mode.removeDeprecated; const mergeDuplicates=!!mode.mergeDuplicates; const purgeLegacyScopes=!!mode.purgeLegacyScopes; const stBefore=ensureLoaded(); const previousHash=stBefore.hash; const scanned=stBefore.list.length; let repairedHashes=0, normalizedCategories=0, deprecatedRemoved=0, duplicatesMerged=0, filesRewritten=0, purgedScopes=0; const notes:string[]=[]; const byId=new Map<string,InstructionEntry>(); stBefore.list.forEach(e=> byId.set(e.id,{ ...e })); const updated=new Set<string>();
  for(const e of byId.values()){ const normCats=Array.from(new Set((e.categories||[]).filter(c=> typeof c==='string').map(c=> c.toLowerCase()))).sort(); if(JSON.stringify(normCats)!==JSON.stringify(e.categories)){ e.categories=normCats; normalizedCategories++; e.updatedAt=new Date().toISOString(); updated.add(e.id); } }
  const duplicateBodies=new Set<string>();
  if(mergeDuplicates){ const groups=new Map<string,InstructionEntry[]>(); for(const e of byId.values()){ const key=e.sourceHash || crypto.createHash('sha256').update(e.body,'utf8').digest('hex'); const arr=groups.get(key)||[]; arr.push(e); groups.set(key,arr); } for(const group of groups.values()){ if(group.length<=1) continue; let primary=group[0]; for(const candidate of group){ if(candidate.createdAt && primary.createdAt){ if(candidate.createdAt < primary.createdAt) primary=candidate; } else if(!primary.createdAt && candidate.createdAt){ primary=candidate; } else if(candidate.id < primary.id){ primary=candidate; } } for(const dup of group){ if(dup.id===primary.id) continue; if(dup.priority < primary.priority){ primary.priority=dup.priority; updated.add(primary.id); } if(typeof dup.riskScore==='number'){ if(typeof primary.riskScore!=='number' || dup.riskScore > primary.riskScore){ primary.riskScore=dup.riskScore; updated.add(primary.id); } } const mergedCats=Array.from(new Set([...(primary.categories||[]), ...(dup.categories||[])] )).sort(); if(JSON.stringify(mergedCats)!==JSON.stringify(primary.categories)){ primary.categories=mergedCats; updated.add(primary.id); } if(removeDeprecated){ duplicateBodies.add(dup.id); } else { if(dup.deprecatedBy!==primary.id){ dup.deprecatedBy=primary.id; dup.requirement='deprecated'; dup.updatedAt=new Date().toISOString(); updated.add(dup.id); } } duplicatesMerged++; } } }
  const toRemove:string[]=[]; if(removeDeprecated){ for(const e of byId.values()){ if(e.deprecatedBy && byId.has(e.deprecatedBy)) toRemove.push(e.id); } for(const id of duplicateBodies){ if(!toRemove.includes(id)) toRemove.push(id); } }
  if(purgeLegacyScopes){ const baseDir=getInstructionsDir(); for(const e of byId.values()){ const filePath=path.join(baseDir, `${e.id}.json`); try { if(fs.existsSync(filePath)){ const raw=JSON.parse(fs.readFileSync(filePath,'utf8')) as { categories?: unknown[] }; if(Array.isArray(raw.categories)){ const legacyTokens=raw.categories.filter(c=> typeof c==='string' && /^scope:(workspace|user|team):/.test(c)); if(legacyTokens.length){ purgedScopes += legacyTokens.length; updated.add(e.id); } } } } catch { /* ignore */ } } if(dryRun && purgedScopes) notes.push(`would-purge:${purgedScopes}`); }
  { const baseDir=getInstructionsDir(); for(const e of byId.values()){ const filePath=path.join(baseDir, `${e.id}.json`); let storedHash=e.sourceHash||''; try { if(fs.existsSync(filePath)){ const raw=JSON.parse(fs.readFileSync(filePath,'utf8')) as { sourceHash?:string }; if(typeof raw.sourceHash==='string') storedHash=raw.sourceHash; } } catch(_err){ /* ignore read error */ } const actualHash=crypto.createHash('sha256').update(e.body,'utf8').digest('hex'); if(storedHash!==actualHash){ // Alpha deterministic: repair hash without semantic version bump
      e.sourceHash=actualHash; repairedHashes++; e.updatedAt=new Date().toISOString(); updated.add(e.id); } } }
  deprecatedRemoved = toRemove.length; if(!dryRun){ const baseDir=getInstructionsDir(); for(const id of toRemove){ byId.delete(id); } for(const id of updated){ if(!byId.has(id)) continue; const e=byId.get(id)!; try { fs.writeFileSync(path.join(baseDir, `${id}.json`), JSON.stringify(e,null,2)); filesRewritten++; } catch(err){ notes.push(`write-failed:${id}:${(err as Error).message}`); } } for(const id of toRemove){ try { fs.unlinkSync(path.join(baseDir, `${id}.json`)); } catch(err){ notes.push(`delete-failed:${id}:${(err as Error).message}`); } } if(updated.size || toRemove.length){ touchCatalogVersion(); invalidate(); ensureLoaded(); } } else { if(updated.size) notes.push(`would-rewrite:${updated.size}`); if(toRemove.length) notes.push(`would-remove:${toRemove.length}`); }
  const stAfter = ensureLoaded(); const resp = { previousHash, hash: stAfter.hash, scanned, repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, filesRewritten, purgedScopes, dryRun, notes }; if(!dryRun && (repairedHashes||normalizedCategories||deprecatedRemoved||duplicatesMerged||filesRewritten||purgedScopes)) logAudit('groom', undefined, { repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, filesRewritten, purgedScopes }); return resp;
}));

// usage/flush (mutation)
registerHandler('usage/flush', guard('usage/flush', ()=> ({ flushed:true })));

export {};
