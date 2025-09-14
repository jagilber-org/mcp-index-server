import fs from 'fs';
import path from 'path';
import { getBooleanEnv } from '../utils/envUtils';

// Trace level hierarchy: off < core < perf < files < verbose
export type TraceLevel = 0|1|2|3|4;

let cachedLevel: TraceLevel = 0;
let lastLevelCheck = 0;

function mapEnvToLevel(): TraceLevel {
  if(process.env.MCP_TRACE_LEVEL){
    const map: Record<string,TraceLevel> = { off:0, core:1, perf:2, files:3, verbose:4 };
    const lvl = map[String(process.env.MCP_TRACE_LEVEL).toLowerCase()];
    if(lvl!=null) return lvl;
  }
  let level: TraceLevel = 0;
  if(getBooleanEnv('MCP_VISIBILITY_DIAG')) level = Math.max(level,1) as TraceLevel;
  if(getBooleanEnv('MCP_TRACE_ALL')) level = Math.max(level,4) as TraceLevel;
  if(getBooleanEnv('MCP_CATALOG_FILE_TRACE')) level = Math.max(level,3) as TraceLevel;
  // Implicit enablement: if persistence requested but no level flags provided, default to 'core'
  if(level===0 && (getBooleanEnv('MCP_TRACE_PERSIST') || process.env.MCP_TRACE_FILE)){
    level = 1 as TraceLevel;
  }
  return level;
}

export function currentTraceLevel(): TraceLevel {
  const now = Date.now();
  if(now - lastLevelCheck > 1500){
    cachedLevel = mapEnvToLevel();
    lastLevelCheck = now;
  }
  return cachedLevel;
}

export function traceEnabled(min: TraceLevel = 1){ return currentTraceLevel() >= min; }

// Persistent file logging (JSONL) setup
let traceStream: fs.WriteStream | null = null;
let traceFilePath: string | null = null;
let traceBytesWritten = 0;
let rotationIndex = 0;
let cachedSessionId: string | null = null;
let cachedCategorySet: Set<string> | null = null;
let lastCategoryEnv: string | null = null;
let maxFileSize = 0; // bytes, 0 = off

function getSessionId(): string {
  if(cachedSessionId) return cachedSessionId;
  const envId = process.env.MCP_TRACE_SESSION || process.env.MCP_TRACE_SESSION_ID;
  cachedSessionId = envId && envId.trim() ? envId.trim() : Math.random().toString(36).slice(2,10);
  return cachedSessionId;
}

function categoriesAllow(label: string): boolean {
  const raw = process.env.MCP_TRACE_CATEGORIES || '';
  if(!raw) return true; // no filter
  if(raw !== lastCategoryEnv){
    lastCategoryEnv = raw;
    cachedCategorySet = new Set(raw.split(/[,;\s]+/).map(s=>s.trim()).filter(Boolean));
  }
  const cats = label
    .replace(/^\[/,'')
    .replace(/]$/,'')
    .split(':')
    .map(s=>s.replace(/^trace/,'').trim())
    .filter(Boolean);
  for(const c of cats){ if(cachedCategorySet!.has(c)) return true; }
  return false;
}

function ensureTraceStream(){
  if(traceStream) return;
  // Explicit file overrides all
  let file = process.env.MCP_TRACE_FILE;
  if(!file && process.env.MCP_TRACE_PERSIST==='1'){
    const dir = process.env.MCP_TRACE_DIR || path.join(process.cwd(),'logs','trace');
    try { if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); } catch { /* ignore */ }
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    file = path.join(dir, `trace-${stamp}.jsonl`);
  }
  if(file){
    try {
      maxFileSize = parseInt(process.env.MCP_TRACE_MAX_FILE_SIZE || '0',10) || 0; // e.g. 5_000_000 for ~5MB
      traceStream = fs.createWriteStream(file,{flags:'a'});
      traceFilePath = file;
      traceBytesWritten = 0;
      rotationIndex = 0;
    } catch { /* ignore */ }
  }
}

function rotateIfNeeded(){
  if(!traceStream || !traceFilePath) return;
  if(!maxFileSize || traceBytesWritten < maxFileSize) return;
  try { traceStream.end(); } catch { /* ignore */ }
  rotationIndex++;
  const base = traceFilePath.replace(/\.jsonl$/,'');
  const rotated = `${base}.${rotationIndex}.jsonl`;
  try {
    traceStream = fs.createWriteStream(rotated,{flags:'a'});
    traceFilePath = rotated;
    traceBytesWritten = 0;
  } catch { /* ignore */ }
}

function getCaller(): string | undefined {
  if(process.env.MCP_TRACE_CALLSITE!=='1' && currentTraceLevel()<4) return undefined; // only for verbose or explicit
  const err = new Error();
  if(!err.stack) return undefined;
  const lines = err.stack.split('\n').slice(3); // skip this fn + emit + wrapper
  for(const l of lines){
    const m = l.match(/at\s+([^\s(]+)/);
    if(m && m[1] && m[1] !== 'Object.emitTrace'){ return m[1]; }
  }
  return undefined;
}

export interface TraceRecord { ts: string; t: number; lvl: TraceLevel; label: string; data?: unknown; func?: string; pid: number; session: string }

// Ring buffer (fallback) for diagnosing missing trace frames when stderr capture drops lines in CI.
// Enabled when MCP_TRACE_BUFFER_SIZE > 0. Optional dump on exit to MCP_TRACE_BUFFER_FILE.
const bufferSize = parseInt(process.env.MCP_TRACE_BUFFER_SIZE || '0',10) || 0;
const traceBuffer: TraceRecord[] = [];
function pushBuffer(rec: TraceRecord){
  if(!bufferSize) return;
  traceBuffer.push(rec);
  if(traceBuffer.length > bufferSize) traceBuffer.splice(0, traceBuffer.length - bufferSize);
}
function dumpTraceBuffer(file?: string){
  if(!bufferSize || !traceBuffer.length) return;
  const target = file || process.env.MCP_TRACE_BUFFER_FILE || path.join(process.cwd(),'logs','trace','trace-buffer.json');
  try { const dir = path.dirname(target); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(target, JSON.stringify({ size: traceBuffer.length, records: traceBuffer }, null, 2)); } catch { /* ignore */ }
}
if(bufferSize && (process.env.MCP_TRACE_BUFFER_DUMP_ON_EXIT === '1' || process.env.MCP_TRACE_BUFFER_FILE)){
  try { process.on('exit', ()=> dumpTraceBuffer()); } catch { /* ignore */ }
}
export function getTraceBuffer(){ return traceBuffer.slice(); }
export function dumpTraceBufferNow(target?:string){ dumpTraceBuffer(target); }

export function emitTrace(label: string, data: unknown, min: TraceLevel = 1){
  if(!traceEnabled(min)) return;
  if(!categoriesAllow(label)) return; // category filter
  const lvl = currentTraceLevel();
  const now = Date.now();
  const rec: TraceRecord = { ts: new Date(now).toISOString(), t: now, lvl, label, data, pid: process.pid, session: getSessionId() } as TraceRecord;
  const func = getCaller();
  if(func) rec.func = func;
  pushBuffer(rec); // always push after constructing record (even if not persisted to file)
  try {
    // eslint-disable-next-line no-console
    console.error(label, JSON.stringify(rec));
  } catch { /* ignore */ }
  if(process.env.MCP_TRACE_PERSIST==='1' || process.env.MCP_TRACE_FILE){
    try {
      ensureTraceStream();
      if(traceStream){
        // Persist in the same bracketed label + JSON format stderr uses so existing analyzers parse it.
        const line = `${label} ${JSON.stringify(rec)}\n`;
        traceStream.write(line);
        traceBytesWritten += Buffer.byteLength(line);
        rotateIfNeeded();
        if(process.env.MCP_TRACE_FSYNC==='1'){
          try {
            const s: fs.WriteStream = traceStream;
            // fd may be undefined until stream is open
            // @ts-expect-error Node typings sometimes mark fd as number | null
            if(typeof s.fd === 'number' && s.fd >= 0){ fs.fsyncSync(s.fd as number); }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}

export function getTraceFile(){ return traceFilePath; }

export interface TraceEnvSummary {
  level: TraceLevel; file?: string | null; session: string; categories?: string[]; maxFileSize?: number; rotationIndex: number;
}

export function summarizeTraceEnv(): TraceEnvSummary {
  const catsRaw = process.env.MCP_TRACE_CATEGORIES || '';
  const categories = catsRaw ? catsRaw.split(/[,;\s]+/).filter(Boolean) : undefined;
  return { level: currentTraceLevel(), file: traceFilePath, session: getSessionId(), categories, maxFileSize, rotationIndex };
}

// Diagnostic helper: when tests detect missing expected trace labels they can invoke trace/dump tool which calls dumpTraceBufferNow.

