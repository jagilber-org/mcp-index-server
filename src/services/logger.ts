import crypto from 'crypto';

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

function emit(rec: LogRecord){
  if(ENABLE_JSON){
    // Structured one-line JSON
    console.error(JSON.stringify(rec));
  } else {
    const parts = [rec.ts, rec.level.toUpperCase(), rec.evt, rec.msg||''];
    if(rec.tool) parts.push(`[${rec.tool}]`);
    if(rec.ms !== undefined) parts.push(`${rec.ms}ms`);
    if(rec.data) parts.push(JSON.stringify(rec.data));
    console.error(parts.filter(Boolean).join(' '));
  }
}

export function log(level: LogRecord['level'], evt: string, fields: Omit<LogRecord,'level'|'evt'|'ts'> = {}){
  emit({ ts: new Date().toISOString(), level, evt, ...fields });
}

export const logDebug = (evt:string, f?:unknown)=> log('debug', evt, { data:f });
export const logInfo = (evt:string, f?:unknown)=> log('info', evt, { data:f });
export const logWarn = (evt:string, f?:unknown)=> log('warn', evt, { data:f });
export const logError = (evt:string, f?:unknown)=> log('error', evt, { data:f });
