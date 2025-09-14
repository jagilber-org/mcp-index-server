import { registerHandler } from '../server/registry';
import { dumpTraceBufferNow, getTraceBuffer, summarizeTraceEnv } from './tracing';
import path from 'path';
import fs from 'fs';

// trace/dump: writes current in-memory ring buffer (if enabled) to a file and returns summary.
// Params: { file?: string }
registerHandler('trace/dump', (p:{ file?: string }) => {
  const file = p?.file || process.env.MCP_TRACE_BUFFER_FILE || path.join(process.cwd(),'snapshots','trace-buffer.json');
  dumpTraceBufferNow(file);
  let size = 0; let bytes = 0;
  try { if(fs.existsSync(file)){ const stat = fs.statSync(file); bytes = stat.size; const raw = JSON.parse(fs.readFileSync(file,'utf8')); if(raw && Array.isArray(raw.records)) size = raw.records.length; } } catch { /* ignore */ }
  return { dumped:true, file, records:size, bytes, env: summarizeTraceEnv(), bufferEnabled: getTraceBuffer().length>0 };
});

export {};
