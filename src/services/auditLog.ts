import fs from 'fs';
import path from 'path';

// Lightweight append-only JSONL transaction log for instruction catalog mutations.
// Each line: { ts, action, ids?, meta? }
// Enabled implicitly when a writable path can be resolved. Set INSTRUCTIONS_AUDIT_LOG to override filename.
// Default path: <repo>/logs/instruction-transactions.log.jsonl (directory auto-created).

let resolvedPath: string | null = null;
function getLogPath(){
  if(resolvedPath) return resolvedPath;
  const explicit = process.env.INSTRUCTIONS_AUDIT_LOG;
  const file = explicit && explicit.trim() ? explicit.trim() : path.join(process.cwd(),'logs','instruction-transactions.log.jsonl');
  try {
    const dir = path.dirname(file);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
    // Touch file if missing (appendFileSync will create, but we also validate writability here)
    fs.appendFileSync(file,'');
    resolvedPath = file;
  } catch {
    resolvedPath = null; // disable if any failure
  }
  return resolvedPath;
}

export interface AuditEntry {
  ts: string; // ISO timestamp
  action: string; // mutation action name
  ids?: string[]; // impacted instruction ids (if any)
  meta?: Record<string, unknown>; // lightweight result summary (counts, flags)
}

export function logAudit(action: string, ids?: string[]|string, meta?: Record<string, unknown>){
  const file = getLogPath();
  if(!file) return; // silent no-op when logging disabled
  const entry: AuditEntry = { ts: new Date().toISOString(), action };
  if(ids){ entry.ids = Array.isArray(ids)? ids: [ids]; }
  if(meta){ entry.meta = meta; }
  try {
    fs.appendFileSync(file, JSON.stringify(entry)+'\n','utf8');
  } catch { /* swallow logging errors to avoid impacting primary mutation path */ }
}

export function readAuditEntries(limit=1000): AuditEntry[] {
  const file = getLogPath();
  if(!file || !fs.existsSync(file)) return [];
  try {
    const lines = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=> l.trim());
    const recent = lines.slice(-limit);
    const parsed: AuditEntry[] = [];
    for(const l of recent){ try { parsed.push(JSON.parse(l)); } catch { /* ignore */ } }
    return parsed;
  } catch { return []; }
}
