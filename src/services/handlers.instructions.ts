import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { InstructionEntry } from '../models/instruction';
import { registerHandler } from '../server/registry';
import { computeGovernanceHash, ensureLoaded, invalidate, projectGovernance, getInstructionsDir, touchCatalogVersion, getDebugCatalogSnapshot } from './catalogContext';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import { ClassificationService } from './classificationService';
import { resolveOwner } from './ownershipService';
import { atomicWriteJson } from './atomicFs';
import { logAudit } from './auditLog';

// Evaluate mutation flag dynamically each invocation so tests that set env before calls (even after import) still work.
function isMutationEnabled(){ return process.env.MCP_ENABLE_MUTATION === '1'; }

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

// Legacy individual instruction handlers removed in favor of unified dispatcher (instructions/dispatch).
// Internal implementation functions retained below for dispatcher direct invocation.
export const instructionActions = {
  list: (p:{category?:string})=>{ const st = ensureLoaded(); let items = st.list; if(p?.category){ const c = p.category.toLowerCase(); items = items.filter(i=> i.categories.includes(c)); } return limitResponseSize({ hash: st.hash, count: items.length, items }); },
  listScoped: (p:{ userId?:string; workspaceId?:string; teamIds?: string[] })=>{ const st=ensureLoaded(); const userId=p.userId?.toLowerCase(); const workspaceId=p.workspaceId?.toLowerCase(); const teamIds=(p.teamIds||[]).map(t=>t.toLowerCase()); const all=st.list; const matchUser = userId? all.filter(e=> (e.userId||'').toLowerCase()===userId):[]; if(matchUser.length) return { hash: st.hash, count: matchUser.length, scope:'user', items:matchUser }; const matchWorkspace = workspaceId? all.filter(e=> (e.workspaceId||'').toLowerCase()===workspaceId):[]; if(matchWorkspace.length) return { hash: st.hash, count: matchWorkspace.length, scope:'workspace', items:matchWorkspace }; const teamSet = new Set(teamIds); const matchTeams = teamIds.length? all.filter(e=> Array.isArray(e.teamIds) && e.teamIds.some(t=> teamSet.has(t.toLowerCase()))):[]; if(matchTeams.length) return { hash: st.hash, count: matchTeams.length, scope:'team', items:matchTeams }; const audienceAll = all.filter(e=> e.audience==='all'); return { hash: st.hash, count: audienceAll.length, scope:'all', items: audienceAll }; },
  get: (p:{id:string})=>{ const st=ensureLoaded(); const item = st.byId.get(p.id); return item? { hash: st.hash, item }: { notFound:true }; },
  search: (p:{q:string})=>{ const st=ensureLoaded(); const q=(p.q||'').toLowerCase(); const items = st.list.filter(i=> i.title.toLowerCase().includes(q)|| i.body.toLowerCase().includes(q)); return { hash: st.hash, count: items.length, items }; },
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
    const categories=Array.from(new Set((Array.isArray(e.categories)? e.categories: []).filter((c):c is string => typeof c==='string').map(c=>c.toLowerCase()))).sort();
    const newBodyHash=crypto.createHash('sha256').update(bodyTrimmed,'utf8').digest('hex');
    let existing:InstructionEntry|null=null; if(fileExists){ try { existing=JSON.parse(fs.readFileSync(file,'utf8')); } catch { existing=null; } }
    // Governance prerequisite rules BEFORE adjusting counters so failures are excluded from imported/overwritten/skipped
    if(e.priorityTier==='P1' && (!categories.length || !e.owner)) { errors.push({ id:e.id, error:'P1 requires category & owner'}); continue; }
    if((e.requirement==='mandatory' || e.requirement==='critical') && !e.owner){ errors.push({ id:e.id, error:'mandatory/critical require owner'}); continue; }
    // Skip/overwrite semantics now that governance validation passed
    if(fileExists && mode==='skip'){ skipped++; continue; }
    if(fileExists && mode==='overwrite') overwritten++; else if(!fileExists) imported++;
    const base: InstructionEntry = existing ? { ...existing, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, updatedAt: now } as InstructionEntry : { id:e.id, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, sourceHash:newBodyHash, schemaVersion:SCHEMA_VERSION, deprecatedBy:e.deprecatedBy, createdAt:now, updatedAt:now, riskScore:e.riskScore, createdByAgent: process.env.MCP_AGENT_ID || undefined, sourceWorkspace: process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE || undefined } as InstructionEntry;
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
  const e = p.entry as ImportEntry | undefined; if(!e) return { error:'missing entry'};
  const lax = !!(p.lax || (e as unknown as { lax?: boolean })?.lax);
  // Apply lax defaults if enabled (allows body-only submissions like tests rely on)
  if(lax){
    if(!e.id) return { error:'missing id' }; // id still mandatory
    // Create a shallow mutable copy to avoid mutating original reference directly with any casts
    const mutable = e as Partial<ImportEntry> & { id:string };
    if(!mutable.title) mutable.title = mutable.id; // title defaults to id
    if(typeof mutable.priority !== 'number') mutable.priority = 50;
    if(!mutable.audience) mutable.audience = 'all' as InstructionEntry['audience'];
    if(!mutable.requirement) mutable.requirement = 'optional';
    if(!Array.isArray(mutable.categories)) mutable.categories = [];
  }
  // Strict validation after lax fill
  if(!e.id || !e.title || !e.body) return { error:'missing required fields'};
  const dir = getInstructionsDir(); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir, `${e.id}.json`); const exists = fs.existsSync(file); const overwrite = !!p.overwrite;
  if(exists && !overwrite){ const st0=ensureLoaded(); logAudit('add', e.id, { skipped:true }); return { id:e.id, skipped:true, created:false, overwritten:false, hash: st0.hash }; }
  const now = new Date().toISOString();
  const bodyTrimmed = typeof e.body==='string'? e.body.trim(): String(e.body||'');
  const categories = Array.from(new Set((Array.isArray(e.categories)? e.categories: []).filter((c):c is string=> typeof c==='string').map(c=> c.toLowerCase()))).sort();
  const sourceHash = crypto.createHash('sha256').update(bodyTrimmed,'utf8').digest('hex');
  // Governance prerequisites
  if(e.priorityTier==='P1' && (!categories.length || !e.owner)) return { id:e.id, error:'P1 requires category & owner' };
  if((e.requirement==='mandatory' || e.requirement==='critical') && !e.owner) return { id:e.id, error:'mandatory/critical require owner' };
  const classifier = new ClassificationService();
  let base: InstructionEntry;
  if(exists){
    try {
      const existing = JSON.parse(fs.readFileSync(file,'utf8')) as InstructionEntry;
      // Start from existing to preserve unspecified fields when overwrite=true but fields omitted (common in tests)
      base = { ...existing } as InstructionEntry;
      // Only overwrite individual fields if explicitly supplied (or lax provided default title)
      if(e.title) base.title = e.title;
      if(e.body) base.body = bodyTrimmed;
      if(e.rationale !== undefined) base.rationale = e.rationale;
      if(typeof e.priority === 'number') base.priority = e.priority;
      if(e.audience) base.audience = e.audience;
      if(e.requirement) base.requirement = e.requirement as InstructionEntry['requirement'];
      if(categories.length) base.categories = categories;
      base.updatedAt = now;
      if(e.version!==undefined) base.version = e.version;
      if(e.changeLog!==undefined) base.changeLog = e.changeLog as InstructionEntry['changeLog'];
    } catch {
      // Fallback if existing unreadable -> treat as new
      base = { id:e.id, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, sourceHash, schemaVersion: SCHEMA_VERSION, deprecatedBy:e.deprecatedBy, createdAt: now, updatedAt: now, riskScore:e.riskScore, createdByAgent: process.env.MCP_AGENT_ID || undefined, sourceWorkspace: process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE || undefined } as InstructionEntry;
    }
  } else {
    base = { id:e.id, title:e.title, body:bodyTrimmed, rationale:e.rationale, priority:e.priority, audience:e.audience, requirement:e.requirement, categories, sourceHash, schemaVersion: SCHEMA_VERSION, deprecatedBy:e.deprecatedBy, createdAt: now, updatedAt: now, riskScore:e.riskScore, createdByAgent: process.env.MCP_AGENT_ID || undefined, sourceWorkspace: process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE || undefined } as InstructionEntry;
  }
  // Pass-through governance fields
  const govKeys: (keyof ImportEntry)[] = ['version','owner','status','priorityTier','classification','lastReviewedAt','nextReviewDue','changeLog','semanticSummary'];
  for(const k of govKeys){ const v = (e as ImportEntry)[k]; if(v!==undefined){ (base as unknown as Record<string, unknown>)[k]=v as unknown; } }
  // Ensure sourceHash reflects trimmed body (only recompute if body changed or new)
  if(!exists || base.body === bodyTrimmed){ base.sourceHash = sourceHash; } else {
    // existing body may not equal trimmed new body if not supplied; ensure hash still correct for current body
    base.sourceHash = crypto.createHash('sha256').update(base.body,'utf8').digest('hex');
  }
  const record = classifier.normalize(base);
  if(record.owner==='unowned'){ const auto=resolveOwner(record.id); if(auto){ record.owner=auto; record.updatedAt=new Date().toISOString(); } }
  try { atomicWriteJson(file, record); } catch(err){ return { id:e.id, error:(err as Error).message||'write-failed' }; }
  touchCatalogVersion(); invalidate(); const st=ensureLoaded(); const resp = { id:e.id, created: !exists, overwritten: exists && overwrite, skipped:false, hash: st.hash }; logAudit('add', e.id, { created: !exists, overwritten: exists && overwrite }); return resp;
}));

registerHandler('instructions/remove', guard('instructions/remove', (p:{ ids:string[]; missingOk?: boolean })=>{ const ids=Array.isArray(p.ids)? Array.from(new Set(p.ids.filter(x=> typeof x==='string' && x.trim()))):[]; if(!ids.length) return { removed:0, missing:[], errors:['no ids supplied'] }; const base=getInstructionsDir(); const missing:string[]=[]; const removed:string[]=[]; const errors:{ id:string; error:string }[]=[]; for(const id of ids){ const file=path.join(base, `${id}.json`); try { if(!fs.existsSync(file)){ missing.push(id); continue; } fs.unlinkSync(file); removed.push(id); } catch(e){ errors.push({ id, error: e instanceof Error? e.message: 'delete-failed' }); } } if(removed.length){ touchCatalogVersion(); invalidate(); ensureLoaded(); } const resp = { removed: removed.length, removedIds: removed, missing, errorCount: errors.length, errors }; logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length }); return resp; }));

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
  const projections=st.list.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(projectGovernance);
  const governanceHash=computeGovernanceHash(st.list);
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
  if(p.status && p.status!==record.status){ record.status=p.status as InstructionEntry['status']; changed=true; }
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
