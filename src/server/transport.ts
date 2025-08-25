/**
 * MCP Transport Layer - stdio JSON-RPC 2.0 Only
 * 
 * This module implements the primary MCP server transport over stdin/stdout.
 * All MCP clients (VS Code, Claude, etc.) communicate exclusively through this stdio transport.
 * 
 * Security: Process-isolated communication with no network exposure.
 * Protocol: JSON-RPC 2.0 line-delimited over stdin/stdout streams.
 * 
 * Note: The optional HTTP dashboard is implemented separately and is for admin use only.
 */
import { createInterface } from 'readline';
import { validateParams } from '../services/validationService';
import fs from 'fs';
import path from 'path';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}
interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export type Handler<TParams = unknown> = (params: TParams) => Promise<unknown> | unknown;

const pkgPath = path.join(process.cwd(), 'package.json');
let VERSION = '0.0.0';
try {
  const raw = JSON.parse(fs.readFileSync(pkgPath,'utf8'));
  VERSION = raw.version || VERSION;
} catch { /* ignore version load failure */ }

const handlers: Record<string, Handler> = {
  'health/check': () => ({ status: 'ok', timestamp: new Date().toISOString(), version: VERSION })
};

// Simple in-memory metrics
interface MetricRecord { count: number; totalMs: number; maxMs: number; }
const metrics: Record<string, MetricRecord> = {};
export function getMetrics(){ return metrics; }

const handlerMeta: Record<string, { method: string }> = {};
export function registerHandler<TParams=unknown>(method: string, handler: Handler<TParams>){
  handlers[method] = handler as Handler;
  handlerMeta[method] = { method };
}

export function listRegisteredMethods(): string[]{
  return Object.keys(handlerMeta).sort();
}

export function getHandler(method: string): Handler | undefined {
  return handlers[method];
}

function makeError(id: string | number | null | undefined, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

function respond(obj: JsonRpcResponse){
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function startTransport(){
  const verbose = process.env.MCP_LOG_VERBOSE === '1';
  const log = (level: 'info'|'error'|'debug', msg: string, extra?: unknown) => {
    if(level === 'debug' && !verbose) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${msg}`;
    try {
      process.stderr.write(line + (extra ? ` ${JSON.stringify(extra)}` : '') + '\n');
    } catch { /* ignore */ }
  };

  // Global crash / rejection safety net to aid diagnostics in host clients that only see silent exits.
  process.on('uncaughtException', (err) => {
    log('error', 'uncaughtException', { message: err.message, stack: err.stack });
    // Still exit (fail fast) but give host time to read line.
    setTimeout(() => process.exit(1), 10);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = typeof reason === 'object' && reason && 'message' in (reason as Record<string,unknown>) ? (reason as { message?: string }).message : String(reason);
    log('error', 'unhandledRejection', { reason: msg });
  });

  // Core protocol lifecycle handlers (initialized flag helps detect improper sequencing)
  let initialized = false;
  registerHandler('initialize', (params: unknown) => {
    const p = params as { protocolVersion?: string } | undefined;
    initialized = true;
    return {
      protocolVersion: p?.protocolVersion || '2025-06-18',
      serverInfo: { name: 'mcp-index-server', version: VERSION },
      capabilities: { roots: { listChanged: true } }
    };
  });
  registerHandler('shutdown', () => ({ shuttingDown: true }));
  registerHandler('exit', () => { setTimeout(() => process.exit(0), 0); return { exiting: true }; });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Emit ready notification (MCP-style event semantics placeholder)
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/ready', params: { version: VERSION } }) + '\n');
  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if(!trimmed) return;
    if(trimmed === 'quit'){ process.exit(0); }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch(err){
      log('error', 'parse_error', { raw: trimmed.slice(0,200) });
      respond(makeError(null, -32700, 'Parse error'));
      return;
    }
    if(req.jsonrpc !== '2.0' || !req.method){
      respond(makeError(req.id ?? null, -32600, 'Invalid Request'));
      return;
    }
    const handler = handlers[req.method];
    if(!handler){
      // Provide richer context for missing method to help client authors.
      const available = listRegisteredMethods();
      log('debug', 'method_not_found', { requested: req.method, availableCount: available.length });
      respond(makeError(req.id ?? null, -32601, 'Method not found', { method: req.method, available }));
      return;
    }
    // Pre-dispatch parameter validation using registry input schemas (when available)
    try {
      const validation = validateParams(req.method, req.params);
      if(!validation.ok){
        respond(makeError(req.id ?? null, -32602, 'Invalid params', { method: req.method, errors: validation.errors }));
        return;
      }
    } catch(e){ /* fail-open on validator issues */ }
    const start = Date.now();
    Promise.resolve()
      .then(() => handler(req.params))
      .then(result => {
        if(!initialized && req.method !== 'initialize'){
          log('debug', 'call_before_initialize', { method: req.method });
        }
        const dur = Date.now() - start;
        const rec = metrics[req.method] || (metrics[req.method] = { count:0,totalMs:0,maxMs:0 });
        rec.count++; rec.totalMs += dur; if(dur > rec.maxMs) rec.maxMs = dur;
        if(req.id !== undefined && req.id !== null){
          respond({ jsonrpc: '2.0', id: req.id, result });
        }
      })
      .catch(e => {
        const dur = Date.now() - start;
        const rec = metrics[req.method] || (metrics[req.method] = { count:0,totalMs:0,maxMs:0 });
        rec.count++; rec.totalMs += dur; if(dur > rec.maxMs) rec.maxMs = dur;
        const errObj = e instanceof Error ? { message: e.message, stack: e.stack } : { message: 'Unknown error', value: e };
        log('error', 'handler_error', { method: req.method, ...errObj });
        respond(makeError(req.id ?? null, -32603, 'Internal error', { method: req.method, ...errObj }));
      });
  });
}

if(require.main === module){
  startTransport();
}
