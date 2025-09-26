import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';

export interface LogRecord {
  ts: string; // ISO timestamp
  level: 'debug' | 'info' | 'warn' | 'error';
  evt: string; // short event key
  msg?: string;
  tool?: string;
  ms?: number;
  data?: unknown;
  correlationId?: string;
}

// Simple correlation id helper (call per incoming JSON-RPC if desired)
export function newCorrelationId(){ return crypto.randomBytes(8).toString('hex'); }

let logFileHandle: fs.WriteStream | null = null;

function loggingCfg(){
  return getRuntimeConfig().logging;
}

// Initialize file logging if MCP_LOG_FILE is specified
function initializeFileLogging(): void {
  const cfg = loggingCfg();
  const logFile = cfg.file;
  if (!logFile || logFileHandle) return; // Already initialized or not requested

  try {
    // Ensure log directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create write stream with append mode
    logFileHandle = fs.createWriteStream(logFile, { 
      flags: 'a',
      encoding: 'utf8'
    });

    // Add session header
    const timestamp = new Date().toISOString();
    const header = `\n=== MCP Index Server Session Started: ${timestamp} ===\n`;
    logFileHandle.write(header);

    // Cleanup on process exit
    process.on('exit', () => {
      if (logFileHandle && !logFileHandle.destroyed) {
        logFileHandle.write(`=== Session Ended: ${new Date().toISOString()} ===\n\n`);
        logFileHandle.end();
      }
    });

    // Log successful initialization (human readable and structured diagnostic)
    console.error(`[logger] File logging enabled: ${logFile}`);
    try {
      const stats = fs.existsSync(logFile) ? fs.statSync(logFile) : null;
      // Emit a structured JSON diagnostic line (always stderr; also written to file once handle active)
      const diag = {
        ts: new Date().toISOString(),
        level: 'info',
        evt: 'logger_init',
        file: logFile,
        created: !!stats,
        size: stats?.size ?? 0,
        pid: process.pid,
        sentinel: cfg.sentinelRequested,
        cwd: process.cwd()
      };
      // Write structured line directly (do not recurse emit to avoid double header or recursion risk)
      const line = cfg.json ? JSON.stringify(diag) : `${diag.ts} INFO logger_init ${diag.file} size=${diag.size} cwd=${diag.cwd}`;
      console.error(line);
      if (logFileHandle && !logFileHandle.destroyed) {
        try { logFileHandle.write(line + '\n'); } catch { /* ignore */ }
      }
    } catch { /* ignore diagnostics error */ }

  } catch (error) {
    // Fallback to stderr only if file logging fails
    console.error(`[logger] Failed to initialize file logging to ${logFile}: ${error}`);
  }
}

// Eager initialization: if user supplied a sentinel value ('1', 'true', etc.)
// we create the log file immediately so external components (dashboard log
// viewer polling /api/logs) see the file even before the first structured
// log line is emitted. Without this, very early polling could race the first
// emit() call and incorrectly report "no log file". Normal explicit paths
// remain lazy to avoid unnecessary fd usage when logger never used.
try {
  const cfg = loggingCfg();
  if(cfg.file && cfg.sentinelRequested){
    initializeFileLogging();
  }
} catch { /* ignore eager init errors */ }

function emit(rec: LogRecord){
  // Initialize file logging on first emit (lazy initialization)
  const cfg = loggingCfg();
  if (!logFileHandle && cfg.file) {
    initializeFileLogging();
  }

  let logLine: string;
  
  if(cfg.json){
    // Structured one-line JSON
    logLine = JSON.stringify(rec);
  } else {
    const parts = [rec.ts, rec.level.toUpperCase(), rec.evt, rec.msg||''];
    if(rec.tool) parts.push(`[${rec.tool}]`);
    if(rec.ms !== undefined) parts.push(`${rec.ms}ms`);
    if(rec.data) parts.push(JSON.stringify(rec.data));
    logLine = parts.filter(Boolean).join(' ');
  }

  // Always log to stderr for VS Code output panel
  console.error(logLine);

  // Also log to file if configured and available
  if (logFileHandle && !logFileHandle.destroyed) {
    try {
      logFileHandle.write(logLine + '\n');
      // Optional deterministic flushing for tests / critical observability. Enabled with MCP_LOG_SYNC=1
      if(cfg.sync) {
        try { fs.fsyncSync((logFileHandle as unknown as { fd: number }).fd); } catch { /* ignore fsync errors */ }
      }
    } catch { /* ignore file write failures */ }
  }
}

export function log(level: LogRecord['level'], evt: string, fields: Omit<LogRecord,'level'|'evt'|'ts'> = {}){
  emit({ ts: new Date().toISOString(), level, evt, ...fields });
}

export const logDebug = (evt:string, f?:unknown)=> log('debug', evt, { data:f });
export const logInfo = (evt:string, f?:unknown)=> log('info', evt, { data:f });
export const logWarn = (evt:string, f?:unknown)=> log('warn', evt, { data:f });
export const logError = (evt:string, f?:unknown)=> log('error', evt, { data:f });
