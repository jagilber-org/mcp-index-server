import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';

// Lightweight append-only JSONL transaction log for instruction catalog mutations.
// Each line: { ts, action, ids?, meta? }
// Path and enablement are driven by runtime configuration (instructions.auditLog).

let cachedKey: string | undefined;
let cachedPath: string | null | undefined;
function resolveLogPath(){
  const { auditLog } = getRuntimeConfig().instructions;
  const key = auditLog.enabled && auditLog.file ? `on:${auditLog.file}` : 'off';
  if(cachedKey === key && cachedPath !== undefined){
    return cachedPath;
  }

  cachedKey = key;
  if(!auditLog.enabled || !auditLog.file){
    cachedPath = null;
    return cachedPath;
  }
  const file = auditLog.file;
  try {
    const dir = path.dirname(file);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, '');
    cachedPath = file;
  } catch {
    cachedPath = null;
  }
  return cachedPath;
}

export function resetAuditLogCache(): void {
  cachedKey = undefined;
  cachedPath = undefined;
}

export interface AuditEntry {
  ts: string; // ISO timestamp
  action: string; // mutation action name
  ids?: string[]; // impacted instruction ids (if any)
  meta?: Record<string, unknown>; // lightweight result summary (counts, flags)
}

export function logAudit(action: string, ids?: string[]|string, meta?: Record<string, unknown>){
  const file = resolveLogPath();
  if(!file) return; // silent no-op when logging disabled
  const entry: AuditEntry = { ts: new Date().toISOString(), action };
  if(ids){ entry.ids = Array.isArray(ids)? ids: [ids]; }
  if(meta){ entry.meta = meta; }
  try {
    fs.appendFileSync(file, JSON.stringify(entry)+'\n','utf8');
  } catch { /* swallow logging errors to avoid impacting primary mutation path */ }
}

export function readAuditEntries(limit=1000): AuditEntry[] {
  const file = resolveLogPath();
  if(!file || !fs.existsSync(file)) return [];
  try {
    const lines = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=> l.trim());
    const recent = lines.slice(-limit);
    const parsed: AuditEntry[] = [];
    for(const l of recent){ try { parsed.push(JSON.parse(l)); } catch { /* ignore */ } }
    return parsed;
  } catch { return []; }
}
