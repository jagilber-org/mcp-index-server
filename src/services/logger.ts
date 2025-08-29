import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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

const ENABLE_JSON = process.env.MCP_LOG_JSON === '1';
let logFileHandle: fs.WriteStream | null = null;

// Initialize file logging if MCP_LOG_FILE is specified
function initializeFileLogging(): void {
  const logFile = process.env.MCP_LOG_FILE;
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

    // Log successful initialization
    console.error(`[logger] File logging enabled: ${logFile}`);

  } catch (error) {
    // Fallback to stderr only if file logging fails
    console.error(`[logger] Failed to initialize file logging to ${logFile}: ${error}`);
  }
}

function emit(rec: LogRecord){
  // Initialize file logging on first emit (lazy initialization)
  if (!logFileHandle && process.env.MCP_LOG_FILE) {
    initializeFileLogging();
  }

  let logLine: string;
  
  if(ENABLE_JSON){
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
