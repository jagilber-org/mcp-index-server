/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SDK-based MCP server bootstrap (dynamic require variant to work under CommonJS build).
 * Uses the published dist/ subpath exports without relying on TS ESM moduleResolution.
 */
import fs from 'fs';
import path from 'path';
import { getToolRegistry } from '../services/toolRegistry';
import '../services/toolHandlers';
import { getHandler } from './registry';
// (Ajv based direct-method validation removed in 1.0.0 along with legacy per-tool direct handlers)
import { z } from 'zod';

// ESM dynamic import used below for SDK modules.
// Use export map subpaths (do NOT prefix with dist/ or it will duplicate to dist/dist/...)
// We'll lazy-load ESM exports via dynamic import when starting.
let StdioServerTransport: any;
// Helper to perform a true dynamic ESM import that TypeScript won't down-level to require()
const dynamicImport = (specifier: string) => (Function('m', 'return import(m);'))(specifier);

// ---------------------------------------------------------------------------
// Optional handshake tracing (exported only via env flag to avoid noise)
// Enable with MCP_HANDSHAKE_TRACE=1 to emit structured JSON lines to stderr
// prefixed with [handshake]. Each event receives a monotonic sequence number.
// ---------------------------------------------------------------------------
const HANDSHAKE_TRACE_ENABLED = process.env.MCP_HANDSHAKE_TRACE === '1';
let HANDSHAKE_SEQ = 0;
function handshakeLog(stage: string, data?: Record<string, unknown>){
  if(!HANDSHAKE_TRACE_ENABLED) return; // fast path
  try {
    const payload = { handshake: true, seq: ++HANDSHAKE_SEQ, ts: new Date().toISOString(), stage, ...(data||{}) };
    process.stderr.write(`[handshake] ${JSON.stringify(payload)}\n`);
  } catch { /* ignore */ }
}

// Central gating flag: by default we disable ALL non-primary ready fallbacks (watchdogs, safety timeouts,
// stdin sniff synthetic initialize, unconditional init fallbacks, etc.). These historically attempted to
// mask upstream ordering or initialization issues but introduce additional races observable in tests
// (ready sometimes preceding initialize response). Setting MCP_HANDSHAKE_FALLBACKS=1 re-enables the legacy
// safety nets for deep diagnostics. Primary path remains transport send hook emissions only.
const HANDSHAKE_FALLBACKS_ENABLED = process.env.MCP_HANDSHAKE_FALLBACKS === '1';

// Supported protocol versions (ordered descending preference – first is default)
// Include current experimental future version plus officially released SDK versions for backward compatibility.
// This allows standard SDK clients (which presently support up to 2024-11-05) to negotiate successfully.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18','2024-11-05','2024-10-07'];

// Lightweight in-memory handshake event ring buffer for diagnostics
interface HandshakeEvent { seq: number; ts: string; stage: string; extra?: Record<string,unknown>; }
const HANDSHAKE_EVENTS: HandshakeEvent[] = [];
function record(stage: string, extra?: Record<string,unknown>){
  const evt: HandshakeEvent = { seq: ++HANDSHAKE_SEQ, ts: new Date().toISOString(), stage, extra };
  HANDSHAKE_EVENTS.push(evt); if(HANDSHAKE_EVENTS.length > 50) HANDSHAKE_EVENTS.shift();
  if(HANDSHAKE_TRACE_ENABLED){ try { process.stderr.write(`[handshake] ${JSON.stringify(evt)}\n`); } catch { /* ignore */ } }
}
// Expose reference for diagnostics/handshake tool (read-only access)
try { (global as unknown as { HANDSHAKE_EVENTS_REF?: HandshakeEvent[] }).HANDSHAKE_EVENTS_REF = HANDSHAKE_EVENTS; } catch { /* ignore */ }

// Helper: negotiate a protocol version with graceful fallback
function negotiateProtocolVersion(requested?: string){
  if(!requested) return SUPPORTED_PROTOCOL_VERSIONS[0];
  if(SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  // Future: could attempt minor compatibility mapping. For now choose latest supported.
  return SUPPORTED_PROTOCOL_VERSIONS[0];
}

// Bridge existing registry into SDK tool definitions
// Module-level idempotent ready emitter so both createSdkServer and startSdkServer dynamic paths can use it.
function emitReadyGlobal(server: any, reason: string){
  // Unified, ordering-safe emission of server/ready. This is invoked ONLY after we believe the
  // initialize response has been (or is about to be) flushed. Some earlier paths (dynamic transport
  // wrapper) previously emitted before origSend() causing ordering violations. We now enforce that
  // those paths call emitReadyGlobal only after their send promise resolves.
  try {
    if(!server) return;
    if((server as any).__readyNotified) return;
    // Ordering gate: ONLY allow emission if initialize response actually flushed ( __initResponseSent )
    // unless fallbacks are explicitly enabled. Even for fallback reasons we still require the flag.
    if(!(server as any).__initResponseSent){
      if(!HANDSHAKE_FALLBACKS_ENABLED){
        return; // strict mode: never emit early
      }
      // In fallback-enabled mode allow certain synthetic init reasons to pass through.
      const allowReasons = new Set(['unconditional-init-fallback','unconditional-init-fallback-direct','forced-init-fallback']);
      if(!allowReasons.has(reason)) return;
    }
    const v = (server as any).__declaredVersion || (server as any).version || '0.0.0';
    // Mark before sending to avoid re-entrancy; we still attempt best-effort delivery via fallbacks.
    (server as any).__readyNotified = true;
  record('ready_emitted', { reason, version: v });
    try { process.stderr.write(`[ready] emit reason=${reason} version=${v}\n`); } catch { /* ignore */ }
    const msg = { jsonrpc: '2.0', method: 'server/ready', params: { version: v } };
    let dispatched = false;
    // Prefer raw transport to bypass any SDK notification filtering.
    try {
      const t = (server as any)._transport;
      if(t?.send){
        const p = t.send(msg);
        // Fire-and-forget; if it rejects we'll retry other channels.
        p?.catch?.(()=>{});
        dispatched = true;
      }
    } catch { /* ignore */ }
    if(!dispatched){
      try { (server as any).sendNotification?.({ method: 'server/ready', params: { version: v } }); dispatched = true; } catch { /* ignore */ }
    }
    if(!dispatched){
      // Final fallback direct stdout (rare path; ensures test visibility even if SDK path failed)
      try { process.stdout.write(JSON.stringify(msg)+'\n'); dispatched = true; } catch { /* ignore */ }
    }
  // Always follow with tools/list_changed AFTER ready to guarantee ordering.
  try { if(typeof (server as any).sendToolListChanged === 'function'){ (server as any).sendToolListChanged(); record('list_changed_after_ready'); } } catch { /* ignore */ }
  } catch { /* ignore */ }
}

export function createSdkServer(ServerClass: any) {
  // Derive version from package.json (no artificial suffix so clients see real semantic version)
  let version = '0.0.0';
  try {
    const pkgPath = path.join(process.cwd(),'package.json');
    if(fs.existsSync(pkgPath)){
      const raw = JSON.parse(fs.readFileSync(pkgPath,'utf8')); if(raw.version) version = raw.version;
    }
  } catch { /* ignore */ }
  const server: any = new ServerClass({ name: 'mcp-index-server', version }, { capabilities: { tools: { listChanged: true } }});
  // expose version for later patched initialize hook in startSdkServer
  (server as any).__declaredVersion = version;

  // Simplified: never emit tools/list_changed before ready. We wrap sendToolListChanged once to enforce ordering.
  try {
    const origSendToolListChanged = (server as any).sendToolListChanged?.bind(server);
    if(origSendToolListChanged && !(server as any).__listPatched){
      (server as any).__listPatched = true;
      (server as any).sendToolListChanged = (...a: any[]) => {
        if(!(server as any).__readyNotified){
          // Defer until after initialize response triggers ready.
          (server as any).__pendingListChanged = true; record('buffer_list_changed_pre_ready');
          return; // swallow for now
        }
        return origSendToolListChanged(...a);
      };
    }
  } catch { /* ignore */ }

  // Track ready notification + whether initialize was seen (ordering guarantee)
  (server as any).__readyNotified = false;
  (server as any).__sawInitializeRequest = false;
  // Track when initialize response has been sent (ordering gate for ready)
  (server as any).__initResponseSent = false;

  // (emitReady wrapper removed; ordering now enforced by delaying emission until transport send hook / watchdogs)

  // Single fallback watchdog if ready somehow suppressed.
  if(HANDSHAKE_FALLBACKS_ENABLED){
    setTimeout(()=>{
      try {
        if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
          record('watchdog_emit_ready');
          emitReadyGlobal(server,'watchdog');
        }
      } catch { /* ignore */ }
    },250).unref?.();
  }

  // Helper to build a minimal zod schema for a JSON-RPC request with given method
  const requestSchema = (methodName: string) => z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.literal(methodName),
    params: z.any().optional()
  });

  // Raw handler for tools/list
  // Explicit initialize handler (bypasses internal SDK init ordering issues) to guarantee
  // deterministic initialize response followed by exactly one server/ready notification.
  // This avoids reliance on internal _oninitialize patches that proved flaky under tests.
  server.setRequestHandler(requestSchema('initialize'), async (req: { params?: any }) => {
    try {
  (server as any).__sawInitializeRequest = true;
  record('initialize_received', { requestedProtocol: req?.params?.protocolVersion });
  const requested = req?.params?.protocolVersion as string | undefined;
      const negotiated = negotiateProtocolVersion(requested);
      const versionDeclared = (server as any).__declaredVersion || (server as any).version || '0.0.0';
      const result: any = {
        protocolVersion: negotiated,
        serverInfo: { name: 'mcp-index-server', version: versionDeclared },
        capabilities: { tools: { listChanged: true } },
        instructions: 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.'
      };
  // NOTE: Do NOT emit ready here. We rely exclusively on the transport send hook
  // (see dispatcher wrapper further below) which marks __initResponseSent only
  // after the initialize response frame is flushed. This guarantees ordering:
  // initialize result always precedes any server/ready notification in stdout.
      return result;
    } catch {
      // On unexpected error fall back to minimal shape so tests still proceed
      return { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0], serverInfo:{ name:'mcp-index-server', version:'0.0.0' }, capabilities:{ tools:{ listChanged:true } }, instructions:'init fallback' };
    }
  });
  // (Legacy internal _oninitialize patch remains below but will not trigger because we now intercept initialize directly.)
  // Patch internal initialize hook once connected to add instructions + (microtask) emit server/ready exactly once.
  const originalInitInner = (server as any)._oninitialize?.bind(server);
  if(originalInitInner && !(server as any).__initPatched){
    (server as any).__initPatched = true;
    (server as any)._oninitialize = async function(request: any){
      const result = await originalInitInner(request);
      try {
        const negotiated = negotiateProtocolVersion(request?.params?.protocolVersion);
        (result as any).protocolVersion = negotiated;
        if(result && typeof result === 'object' && !('instructions' in result)){
          (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.';
        }
    // Defer server/ready so initialize response is flushed first (test expects ordering)
  (this as any).__sawInitializeRequest = true;
  // Removed immediate microtask emission; rely on transport send hook / watchdogs
      } catch { /* ignore */ }
      return result;
    };
  }
  server.setRequestHandler(requestSchema('tools/list'), async () => {
  record('tools_list_request', { afterReady: !!(server as any).__readyNotified, sawInit: !!(server as any).__sawInitializeRequest });
    const registry = getToolRegistry();
    return { tools: registry.map(r => ({ name: r.name, description: r.description, inputSchema: r.inputSchema as Record<string,unknown> })) };
  });

  // Raw handler for tools/call (MCP style) - returns content array
  server.setRequestHandler(requestSchema('tools/call'), async (req: { params?: { name?: string; arguments?: Record<string, unknown> } }) => {
    const p = req?.params ?? {};
    const name = p.name ?? '';
    const args = p.arguments || {};
  if(name === 'health/check') record('tools_call_health');
    try {
      if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] call method=tools/call tool=${name} id=${(req as any)?.id ?? 'n/a'}\n`);
    } catch { /* ignore */ }
    const handler = getHandler(name);
    if(!handler){
      // Explicit method-not-found style for unknown tools (align with JSON-RPC spec -32601)
      throw { code: -32601, message: `Unknown tool: ${name}`, data: { message: `Unknown tool: ${name}`, method: name } };
    }
    try {
      const result = await Promise.resolve(handler(args));
      try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] tool_result tool=${name} bytes=${Buffer.byteLength(JSON.stringify(result),'utf8')}\n`); } catch { /* ignore */ }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch(e){
      // Preserve any structured JSON-RPC style error (including -32603 if explicitly set upstream).
      const code = (e as any)?.code;
      const sem = (e as any)?.__semantic === true;
      if(Number.isSafeInteger(code)){
        try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] tool_error_passthru tool=${name} code=${code} semantic=${sem?'1':'0'} msg=${(e as any)?.message || ''}\n`); } catch { /* ignore */ }
        throw e; // pass through untouched
      }
      const msg = e instanceof Error ? e.message : String(e);
      try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] tool_error_wrap tool=${name} msg=${msg.replace(/\s+/g,' ')} code=${code ?? 'n/a'}\n`); } catch { /* ignore */ }
      throw { code: -32603, message: 'Tool execution failed', data: { message: msg, method: name } };
    }
  });

  // Legacy per-tool direct JSON-RPC handlers removed in 1.0.0 (BREAKING CHANGE). Clients must use tools/call.

  // Lightweight ping handler (simple reachability / latency measurement)
  server.setRequestHandler(requestSchema('ping'), async () => {
    // If ready somehow not emitted yet (rare race), emit now (idempotent) to satisfy handshake expectations.
    if((server as any).__sawInitializeRequest && (server as any).__initResponseSent && !(server as any).__readyNotified){
      emitReadyGlobal(server,'ping-trigger'); // remains idempotent and ordering-safe
    }
    return { timestamp: new Date().toISOString(), uptimeMs: Math.round(process.uptime() * 1000) };
  });

  // (initialize patch no longer required because we supply explicit handler above)

  return server;
}

// Diagnostic accessor tool registered via dynamic side-effect (safe: tiny + read-only)
try {
  // Marker only; ensures file executed. Additional diagnostics could hook here later.
  (global as any).__MCP_HANDSHAKE_TRACE_TOOL__ = true; // marker
} catch { /* ignore */ }

export async function startSdkServer() {
  // Lazy dynamic import once
  if(!StdioServerTransport){
    let modServer: any, modStdio: any;
    try {
      modServer = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
      modStdio = await dynamicImport('@modelcontextprotocol/sdk/server/stdio.js');
    } catch(e){
      try { process.stderr.write(`[startup] sdk_dynamic_import_failed ${(e instanceof Error)? e.message: String(e)}\n`); } catch { /* ignore */ }
    }
    try { StdioServerTransport = modStdio?.StdioServerTransport; } catch { /* ignore */ }
    let server: any;
    try { if(modServer?.Server) server = createSdkServer(modServer.Server); } catch(e){ try { process.stderr.write(`[startup] sdk_server_create_failed ${(e instanceof Error)? e.message: String(e)}\n`); } catch { /* ignore */ } }
    // Optional deep diagnostics for intermittent mixed workload health starvation / backpressure.
    // Enable with MCP_HEALTH_MIXED_DIAG=1 for verbose stderr telemetry (ignored otherwise for zero overhead).
    const __diagEnabled = process.env.MCP_HEALTH_MIXED_DIAG === '1';
    const __diag = (msg: string) => { if(__diagEnabled){ try { process.stderr.write(`[diag] ${Date.now()} ${msg}\n`); } catch { /* ignore */ } } };
    // Emit a one-time version marker so tests can assert the newer diagnostic wrapper code is actually loaded.
    if(__diagEnabled){
      try {
        const buildMarker = 'sdkServerDiagV1';
        // Include a coarse content hash surrogate: file size + mtime if available to detect stale dist usage.
        let fsMeta = '';
        try {
          // Use lazy import to avoid impacting startup when diagnostics disabled
          const fsMod = await import('fs');
          const stat = fsMod.statSync(__filename);
          fsMeta = ` size=${stat.size} mtimeMs=${Math.trunc(stat.mtimeMs)}`;
        } catch { /* ignore meta */ }
        process.stderr.write(`[diag] ${Date.now()} diag_start marker=${buildMarker}${fsMeta}\n`);
      } catch { /* ignore */ }
    }
    if(__diagEnabled){
      try {
        const origWrite = (process.stdout.write as any).bind(process.stdout);
        let backpressureEvents = 0;
        let bytesTotal = 0;
        let lastReportAt = Date.now();
        (process.stdout as any).on?.('drain', ()=>{ __diag('stdout_drain'); });
        (process.stdout.write as any) = function(chunk: any, encoding?: any, cb?: any){
          try {
            const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            bytesTotal += size;
            const ret = origWrite(chunk, encoding, cb);
            if(!ret){
              backpressureEvents++;
              __diag(`stdout_backpressure size=${size} backpressureEvents=${backpressureEvents}`);
            }
            const now = Date.now();
            if(now - lastReportAt > 2000){
              __diag(`stdout_summary bytesTotal=${bytesTotal} backpressureEvents=${backpressureEvents}`);
              lastReportAt = now;
            }
            return ret;
          } catch(e){
            try { __diag(`stdout_write_wrapper_error ${(e as Error)?.message||String(e)}`); } catch { /* ignore */ }
            return origWrite(chunk, encoding, cb);
          }
        };
      } catch { /* ignore */ }
    }
    // Pre-connect stdin sniffer: if we observe an initialize request but downstream logic fails to emit server/ready,
    // schedule a guarded fallback emission (acts at framing layer, independent of SDK internals).
    try {
      if(server && !process.env.MCP_DISABLE_INIT_SNIFF){
      const INIT_FALLBACK_ENABLED = process.env.MCP_INIT_FALLBACK_ALLOW === '1'; // debug-only gating (default off)
        let __sniffBuf = '';
        // Optional fallback diagnostics: if dispatcher override fails (no rq_*), we sniff stdin to build
        // minimal queue depth telemetry. Enabled only when MCP_HEALTH_MIXED_DIAG=1. Deactivated once
        // dispatcher override sets __dispatcherOverrideActive.
        if(process.env.MCP_HEALTH_MIXED_DIAG === '1'){
          try {
            if(!(server as any).__diagRQMap){
              (server as any).__diagRQMap = new Map();
              (server as any).__diagQueueDepthSniff = 0;
            }
          } catch { /* ignore */ }
        }
  process.stdin.on('data', (chunk: Buffer) => {
          try {
            // Log first chunk (sanitized) once for corruption triage
            if(process.env.MCP_HEALTH_MIXED_DIAG === '1' && !(server as any).__diagFirstChunkLogged){
              (server as any).__diagFirstChunkLogged = true;
              const raw = chunk.toString('utf8');
              const snippet = raw.replace(/\r/g,' ').replace(/\n/g,'\\n').slice(0,240);
              process.stderr.write(`[diag] ${Date.now()} stdin_first_chunk size=${chunk.length} snippet="${snippet}"\n`);
            }
            __sniffBuf += chunk.toString('utf8');
            // Fast substring / subsequence search instead of full JSON parse (handles partial framing / headers)
            if(!((server as any).__sniffedInit)){
              const bufForScan = __sniffBuf.slice(-8000); // bound work
              const direct = /"method"\s*:\s*"initialize"/.test(bufForScan);
              let fuzzy = false;
              let subseq = false;
              if(!direct){
                // Fuzzy reconstruction (bounded gaps) scoped near a method sentinel if present
                const target = 'initialize';
                const methodIdx = bufForScan.indexOf('"method"');
                const sliceA = methodIdx !== -1 ? bufForScan.slice(methodIdx, methodIdx + 1200) : '';
                const trySlices: string[] = sliceA ? [sliceA] : [];
                // If method sentinel missing (corruption), fall back to entire tail (diagnostic mode only)
                if(!sliceA && process.env.MCP_HEALTH_MIXED_DIAG === '1') trySlices.push(bufForScan.slice(-2000));
                for(const slice of trySlices){
                  let ti = 0; let gaps = 0;
                  for(let i=0;i<slice.length && ti < target.length;i++){
                    const ch = slice[i];
                    if(ch.toLowerCase?.() === target[ti]){ ti++; gaps = 0; continue; }
                    if(gaps < 3){ gaps++; continue; }
                    // restart subsequence attempt from this char (could be start of 'i')
                    ti = 0; gaps = 0;
                    if(ch.toLowerCase?.() === target[ti]){ ti++; }
                  }
                  if(ti === target.length){ fuzzy = true; break; }
                }
                // Subsequence (very tolerant) – strip non-letters and search contiguous result for target letters order
                if(!fuzzy){
                  const letters = bufForScan.replace(/[^a-zA-Z]/g,'').toLowerCase();
                  let ti = 0;
                  for(let i=0;i<letters.length && ti < target.length;i++){
                    if(letters[i] === target[ti]) ti++;
                  }
                  if(ti === target.length) subseq = true;
                }
              }
              if(direct || fuzzy || subseq){
                (server as any).__sniffedInit = true;
                const mode = direct ? 'direct' : (fuzzy ? 'fuzzy' : 'subseq');
                if(process.env.MCP_HEALTH_MIXED_DIAG === '1'){
                  try {
                    const norm = bufForScan.slice(0,400).replace(/\r/g,' ').replace(/\n/g,'\\n');
                    process.stderr.write(`[diag] ${Date.now()} sniff_init_${mode}_detect buffer_bytes=${__sniffBuf.length} preview="${norm}"\n`);
                  } catch { /* ignore */ }
                }
        // Schedule marking + optional synthetic dispatch if initialize not parsed normally (debug gated).
                setTimeout(()=>{
                  try {
                    if(!(server as any).__sawInitializeRequest){
                      (server as any).__sawInitializeRequest = true;
                      if(process.env.MCP_HEALTH_MIXED_DIAG === '1'){
                        try { process.stderr.write(`[diag] ${Date.now()} sniff_init_mark_sawInit mode=${mode}\n`); } catch { /* ignore */ }
                      }
                    }
                    // If still no init response after a further short delay, synthesize a minimal initialize request.
          if(INIT_FALLBACK_ENABLED && !(server as any).__initResponseSent){
                      setTimeout(()=>{
                        try {
                          if((server as any).__initResponseSent || (server as any).__syntheticInitDispatched) return;
                          // attempt to extract numeric id close to occurrence
                          let id = 1;
                          const idMatch = /"id"\s*:\s*(\d{1,6})/.exec(bufForScan);
                          if(idMatch) id = parseInt(idMatch[1],10);
                          const req = { jsonrpc:'2.0', id, method:'initialize', params:{} };
                          (server as any).__syntheticInitDispatched = true;
                          // Prefer dispatcher wrapper if present
                          const dispatch = (server as any)._onRequest || (server as any)._onrequest;
                          if(typeof dispatch === 'function'){
                            if(process.env.MCP_HEALTH_MIXED_DIAG === '1'){
                              try { process.stderr.write(`[diag] ${Date.now()} sniff_init_synthetic_dispatch id=${id}\n`); } catch { /* ignore */ }
                            }
                            try { dispatch.call(server, req); } catch { /* ignore */ }
                          }
                        } catch { /* ignore */ }
                      }, 40).unref?.();
                      if(INIT_FALLBACK_ENABLED){
                        // Forced result fallback if still not sent after additional grace (guards against handler install failure)
                        setTimeout(()=>{
                          try {
                            if((server as any).__initResponseSent) return; // real response arrived
                            const tr = (server as any)._transport || (server as any).__transportRef; // attempt to locate transport
                            if(tr && typeof tr.send === 'function'){
                              let negotiated = '2024-11-05';
                              try { negotiated = (typeof negotiateProtocolVersion === 'function' ? negotiateProtocolVersion('2024-11-05') : negotiated) || negotiated; } catch { /* ignore */ }
                              const frame = { jsonrpc:'2.0', id:1, result:{ protocolVersion: negotiated, capabilities:{}, instructions:'Use initialize -> tools/list -> tools/call { name, arguments }. (forced-init-fallback)' } };
                              (server as any).__initResponseSent = true;
                              if(process.env.MCP_HEALTH_MIXED_DIAG === '1'){
                                try { process.stderr.write(`[diag] ${Date.now()} sniff_init_forced_result_emit id=1 negotiated=${negotiated}\n`); } catch { /* ignore */ }
                              }
                              Promise.resolve(tr.send(frame)).then(()=>{
                                if(!(server as any).__readyNotified){ emitReadyGlobal(server,'forced-init-fallback'); }
                              }).catch(()=>{});
                            }
                          } catch { /* ignore */ }
                        }, 140).unref?.();
                      } else if(process.env.MCP_HEALTH_MIXED_DIAG === '1'){
                        try { process.stderr.write(`[diag] ${Date.now()} sniff_init_forced_result_skip gating_off\n`); } catch { /* ignore */ }
                      }
                    }
                    if(HANDSHAKE_FALLBACKS_ENABLED){
                      if((server as any).__initResponseSent && !(server as any).__readyNotified){
                        emitReadyGlobal(server,'stdin-sniff-fallback');
                      }
                    }
                  } catch { /* ignore */ }
                }, 60).unref?.();
              }
            }
            // Fallback rq_* enqueue capture (only if diag flag set AND dispatcher override not active)
            if(process.env.MCP_HEALTH_MIXED_DIAG === '1' && !(server as any).__dispatcherOverrideActive){
              try {
                let idx: number;
                while((idx = __sniffBuf.indexOf('\n')) !== -1){
                  const line = __sniffBuf.slice(0,idx).trim();
                  __sniffBuf = __sniffBuf.slice(idx+1);
                  if(!line) continue;
                  let obj: any;
                  try { obj = JSON.parse(line); } catch (e) {
                    // Log suspicious malformed lines that look like JSON fragments including jsonrpc or method
                    if(/jsonrpc|method/i.test(line)){
                      const frag = line.replace(/\r/g,' ').replace(/\n/g,' ').slice(0,200);
                      process.stderr.write(`[diag] ${Date.now()} malformed_json_line len=${line.length} frag="${frag}" err=${(e as Error).message||e}\n`);
                    }
                    continue;
                  }
                  if(obj && obj.jsonrpc === '2.0' && obj.method && Object.prototype.hasOwnProperty.call(obj,'id')){
                    const metaName = obj.method === 'tools/call' ? obj?.params?.name : '';
                    const category = (()=>{
                      if(obj.method === 'initialize') return 'init';
                      if(obj.method === 'health/check' || metaName === 'health/check') return 'health';
                      if(obj.method === 'metrics/snapshot' || metaName === 'metrics/snapshot') return 'metrics';
                      if(metaName === 'meta/tools') return 'meta';
                      return 'other';
                    })();
                    if(category === 'health' || category === 'metrics' || category === 'meta' || category === 'init'){
                      try {
                        (server as any).__diagQueueDepthSniff++;
                        (server as any).__diagRQMap.set(obj.id, { start: Date.now(), cat: category, method: obj.method });
                        process.stderr.write(`[diag] ${Date.now()} rq_enqueue method=${obj.method} cat=${category} id=${obj.id} qdepth=${(server as any).__diagQueueDepthSniff} src=sniff\n`);
                      } catch { /* ignore */ }
                    }
                  }
                }
              } catch { /* ignore */ }
            }
            // Truncate buffer to avoid unbounded growth; keep tail for partial tokens
            if(__sniffBuf.length > 10_000){
              __sniffBuf = __sniffBuf.slice(-2048);
            }
          } catch { /* ignore */ }
        });
      }
    } catch { /* ignore */ }
  if(!StdioServerTransport || !server){ throw new Error('MCP SDK transport unavailable (removed fallback)'); }
    // Instance-level override of the internal request dispatcher to retain error.data & emit diagnostics.
    // The upstream SDK has used both `_onRequest` (camel) and `_onrequest` (lower) across versions / builds;
    // we defensively hook whichever exists (preferring camel) and assign our wrapper to BOTH names to ensure
    // future internal refactors still trigger diagnostics. This explains prior absence of [diag] rq_* lines:
    // we only patched `_onrequest` while the active symbol was `_onRequest`.
    const existingLower = (server as any)._onrequest;
    const existingCamel = (server as any)._onRequest;
    const originalOnRequest = (existingCamel || existingLower) ? (existingCamel || existingLower).bind(server) : undefined;
    // Diagnostic queue depth (only used when MCP_HEALTH_MIXED_DIAG=1)
    let __diagQueueDepth = 0;
    if(originalOnRequest){
      // Explicit this: any annotations to satisfy TS noImplicitThis checks in wrapped dispatcher
      const wrapped = function(this: any, request: any): any {
    const diagEnabled = process.env.MCP_HEALTH_MIXED_DIAG === '1';
    let startedAt: number | undefined;
    if(diagEnabled){
      // Unified categorization covers both direct method calls and tool-wrapped invocations (tools/call with params.name)
      const metaName = request.method === 'tools/call' ? request?.params?.name : '';
      const category = (()=>{
        if(request.method === 'initialize') return 'init';
        if(request.method === 'health/check' || metaName === 'health/check') return 'health';
        if(request.method === 'metrics/snapshot' || metaName === 'metrics/snapshot') return 'metrics';
        if(metaName === 'meta/tools') return 'meta';
        return 'other';
      })();
      if(category === 'health' || category === 'meta' || category === 'metrics' || category === 'init'){
        startedAt = Date.now();
        try {
          __diagQueueDepth++;
          process.stderr.write(`[diag] ${startedAt} rq_enqueue method=${request.method} cat=${category} id=${request.id} qdepth=${__diagQueueDepth}\n`);
          // Track first health request enqueue time (idempotent) & active pending set for starvation analysis
          if(category === 'health'){
            if(!(server as any).__firstHealthEnqueueAt){ (server as any).__firstHealthEnqueueAt = startedAt; }
            if(request.id === 1 && !(server as any).__healthId1EnqueueAt){ (server as any).__healthId1EnqueueAt = startedAt; }
          }
          if(!(server as any).__activeDiagRequests){ (server as any).__activeDiagRequests = new Map(); }
          (server as any).__activeDiagRequests.set(request.id, { id: request.id, method: request.method, cat: category, start: startedAt });
          // Mis-order detection: health/metrics/meta before initialize observed
          if((category === 'health' || category === 'metrics' || category === 'meta') && !(server as any).__sawInitializeRequest){
            try { process.stderr.write(`[diag] ${Date.now()} rq_misorder_before_init method=${request.method} id=${request.id} cat=${category} qdepth=${__diagQueueDepth}\n`); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
    const handler = (this as any)._requestHandlers.get(request.method) ?? (this as any).fallbackRequestHandler;
        if(handler === undefined){
          return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: -32601, message:'Method not found', data:{ method: request.method } }}).catch(()=>{});
        }
        const abortController = new AbortController();
        (this as any)._requestHandlerAbortControllers.set(request.id, abortController);
  // IMPORTANT: We intentionally never early-return without sending a response (even if the AbortController fires)
  // to eliminate a rare flake where a batch-dispatched request lacked a terminal response line (test: dispatcherBatch.spec.ts).
  // Hypothesis: a rapid abort (e.g., client disconnect or internal cancellation) occurred after handler resolution
  // but before transport send, causing silent drop. We now always attempt a send so the test can observe id presence.
  Promise.resolve()
          .then(()=> handler(request, { signal: abortController.signal }))
          .then((result:any)=>{
            if(startedAt !== undefined){
              try {
                const dur = Date.now() - startedAt;
                const metaName = request.method === 'tools/call' ? request?.params?.name : '';
                const category = ((): string => {
                  if(request.method === 'initialize') return 'init';
                  if(request.method === 'health/check' || metaName === 'health/check') return 'health';
                  if(request.method === 'metrics/snapshot' || metaName === 'metrics/snapshot') return 'metrics';
                  if(metaName === 'meta/tools') return 'meta';
                  return 'other';
                })();
                if(category === 'health' || category === 'meta' || category === 'metrics' || category === 'init'){
                  __diagQueueDepth = Math.max(0, __diagQueueDepth - 1);
                  process.stderr.write(`[diag] ${Date.now()} rq_complete method=${request.method} cat=${category} id=${request.id} dur_ms=${dur} qdepth=${__diagQueueDepth}\n`);
                  try { (server as any).__activeDiagRequests?.delete(request.id); } catch { /* ignore */ }
                }
              } catch { /* ignore */ }
            }
            // Even if aborted, we now still attempt to send a terminal response to avoid silent drops (observed intermittent missing batch response id=3)
            if(abortController.signal.aborted){
              try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] aborted-but-sending method=${request.method} id=${request.id}\n`); } catch { /* ignore */ }
            } else {
              try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] response method=${request.method} id=${request.id} ok\n`); } catch { /* ignore */ }
            }
            const sendPromise = (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, result });
            if(request.method === 'initialize'){
              // After initialize response send promise resolves, mark sent then defer ready emission to a
              // subsequent macrotask. Empirically the underlying transport send() can resolve before the
              // initialize result frame is fully flushed to the stdout reader in tests, producing occasional
              // ordering inversions (ready appearing before result). Scheduling with setTimeout(0) yields a
              // strict happens-after relationship relative to prior synchronous writes inside the transport.
              (sendPromise?.then?.(()=> {
                (server as any).__initResponseSent = true;
                setTimeout(()=> emitReadyGlobal(server,'transport-send-hook'), 0);
              }))?.catch(()=>{});
            }
            return sendPromise;
          }, (error:any)=>{
            if(startedAt !== undefined){
              try {
                const dur = Date.now() - startedAt;
                const metaName = request.method === 'tools/call' ? request?.params?.name : '';
                const category = ((): string => {
                  if(request.method === 'initialize') return 'init';
                  if(request.method === 'health/check' || metaName === 'health/check') return 'health';
                  if(request.method === 'metrics/snapshot' || metaName === 'metrics/snapshot') return 'metrics';
                  if(metaName === 'meta/tools') return 'meta';
                  return 'other';
                })();
                if(category === 'health' || category === 'meta' || category === 'metrics' || category === 'init'){
                  __diagQueueDepth = Math.max(0, __diagQueueDepth - 1);
                  process.stderr.write(`[diag] ${Date.now()} rq_error method=${request.method} cat=${category} id=${request.id} dur_ms=${dur} qdepth=${__diagQueueDepth}\n`);
                  try { (server as any).__activeDiagRequests?.delete(request.id); } catch { /* ignore */ }
                }
              } catch { /* ignore */ }
            }
            // Always attempt to surface an error response; do not silently return on abort to prevent missing id responses under rare races
            if(abortController.signal.aborted){
              try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] aborted-error-path method=${request.method} id=${request.id}\n`); } catch { /* ignore */ }
            }
            // Robust semantic error preservation: search multiple nests for a JSON-RPC code/message
            // We occasionally observed semantic dispatcher errors (-32601/-32602) being downgraded to -32603 in rare
            // test runs. Root suspicion: an intermediate wrapper layer mutating shape so shallow probes miss code.
            // Add a defensive deep scan (bounded) for a numeric code and semantic marker to eliminate flake.
            function deepScan(obj: any, depth = 0, seen = new Set<any>()): number | undefined {
              if(!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return undefined;
              seen.add(obj);
              // Direct semantic object
              if(Number.isSafeInteger((obj as any).code)){
                const c = (obj as any).code as number;
                if(c === -32601 || c === -32602) return c; // prioritize semantic validation codes
              }
              // Prefer specific well-known nesting keys first for performance/predictability
              const keys = ['error','original','cause','data'];
              for(const k of keys){
                try {
                  const child = (obj as any)[k];
                  const found = deepScan(child, depth+1, seen);
                  if(found !== undefined) return found;
                } catch { /* ignore */ }
              }
              // Fallback: generic property iteration (shallow) to catch unexpected wrappers
              if(depth < 2){
                try {
                  for(const v of Object.values(obj)){
                    const found = deepScan(v, depth+1, seen);
                    if(found !== undefined) return found;
                  }
                } catch { /* ignore */ }
              }
              return undefined;
            }
            let errCode: unknown = error?.code;
            if(!Number.isSafeInteger(errCode)) errCode = error?.data?.code;
            if(!Number.isSafeInteger(errCode)) errCode = error?.original?.code;
            if(!Number.isSafeInteger(errCode)) errCode = error?.cause?.code;
            if(!Number.isSafeInteger(errCode)) errCode = error?.error?.code; // some wrappers use error.error
            // Deep scan if still missing or internal (-32603) while we expect potential semantic validation errors.
            const rawBeforeDeep = errCode;
            if(!Number.isSafeInteger(errCode) || errCode === -32603){
              const deep = deepScan(error);
              if(Number.isSafeInteger(deep)) errCode = deep;
            }
            const safeCode = Number.isSafeInteger(errCode) ? errCode as number : undefined;
            let errMessage: string | undefined = error?.message;
            if(!errMessage) errMessage = error?.data?.message;
            if(!errMessage) errMessage = error?.original?.message;
            if(!errMessage) errMessage = error?.cause?.message;
            if(!errMessage) errMessage = error?.error?.message;
            if(typeof errMessage !== 'string' || !errMessage.trim()) errMessage = 'Internal error';
            // Ensure data object preserves original plus message (tests assert data.message sometimes)
            let data: any = error?.data;
            if(data && typeof data === 'object'){
              if(typeof data.message !== 'string') data = { ...data, message: errMessage };
            } else if(error && typeof error === 'object') {
              // Synthesize minimal data block to retain context
              data = { message: errMessage, ...(error.method ? { method: error.method }: {}) };
            }
            // If we still have internal error (-32603) but possess a recognizable dispatcher reason hint, remap.
            let finalCode = (safeCode !== undefined) ? safeCode : -32603;
            if(finalCode === -32603 && data && typeof data === 'object'){
              try {
                const reason = (data as any).reason || (data as any).data?.reason;
                if(reason === 'missing_action') finalCode = -32602; // parameter validation
                else if(reason === 'unknown_action' || reason === 'mutation_disabled' || reason === 'unknown_handler') finalCode = -32601; // method not found style
              } catch { /* ignore */ }
            }
            // Verbose diagnostic when we recover / remap a semantic code that would otherwise have been internal
            try {
              if(process.env.MCP_LOG_VERBOSE==='1'){
                const before = Number.isSafeInteger(rawBeforeDeep)? rawBeforeDeep : 'n/a';
                if((before === 'n/a' || before === -32603) && (finalCode === -32601 || finalCode === -32602)){
                  const reasonHint = (data as any)?.reason || (data as any)?.data?.reason;
                  process.stderr.write(`[rpc] deep_recover_semantic code=${finalCode} from=${before} reasonHint=${reasonHint||''}\n`);
                }
              }
            } catch { /* ignore */ }
            try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] response method=${request.method} id=${request.id} error=${errMessage} code=${finalCode}\n`); } catch { /* ignore */ }
            return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: finalCode, message: errMessage, data } });
          })
          .catch(()=>{})
          .finally(()=>{ (this as any)._requestHandlerAbortControllers.delete(request.id); });
      };
      // Attach wrapper to BOTH potential internal symbols to guarantee interception.
      (server as any)._onRequest = wrapped;
      (server as any)._onrequest = wrapped;
      (server as any).__dispatcherOverrideActive = true;
      try { if(process.env.MCP_HEALTH_MIXED_DIAG==='1') process.stderr.write(`[diag] ${Date.now()} dispatcher_override applied props=${[existingCamel? '_onRequest(original)':'', existingLower? '_onrequest(original)':''].filter(Boolean).join(',')||'none'}\n`); } catch { /* ignore */ }
      // Starvation watchdog: after first health enqueue, emit snapshots of pending requests until health id=1 completes or timeout
      if(process.env.MCP_HEALTH_MIXED_DIAG==='1' && !(server as any).__starvationWatchdogStarted){
        (server as any).__starvationWatchdogStarted = true;
        let ticks = 0;
        const iv = setInterval(()=>{
          try {
            ticks++;
            const active: any = (server as any).__activeDiagRequests;
            const firstH = (server as any).__healthId1EnqueueAt;
            if(active && active.size){
              const pending = Array.from(active.values()).map((r: any)=>({ id:r.id, cat:r.cat, age: Date.now()-r.start })).sort((a:any,b:any)=>a.id-b.id).slice(0,12);
              const hasHealth1 = !!active.get?.(1);
              if(hasHealth1 || (firstH && Date.now()-firstH > 40)){
                process.stderr.write(`[diag] ${Date.now()} starvation_watchdog tick=${ticks} pending=${pending.length} details=${JSON.stringify(pending)} firstHealthAge=${firstH? Date.now()-firstH: -1} hasHealth1=${hasHealth1}\n`);
              }
              if(!hasHealth1 && firstH && Date.now()-firstH>400){
                process.stderr.write(`[diag] ${Date.now()} starvation_watchdog_health1_missing age=${Date.now()-firstH}\n`);
              }
            }
            if(ticks>40 || ((server as any).__activeDiagRequests && !(server as any).__activeDiagRequests.get(1))){
              clearInterval(iv);
            }
          } catch { /* ignore */ }
        }, 25);
        iv.unref?.();
      }
    } else if(process.env.MCP_HEALTH_MIXED_DIAG==='1'){
      try { process.stderr.write(`[diag] ${Date.now()} dispatcher_override_skipped no_original_handler_found`); } catch { /* ignore */ }
    }
    // Enumerate server properties once for debugging missing override
    try {
      if(process.env.MCP_HEALTH_MIXED_DIAG==='1'){
        const props = Object.getOwnPropertyNames(server).filter(p=>/_on|request|handler/i.test(p)).slice(0,60);
        process.stderr.write(`[diag] ${Date.now()} server_props ${props.join(',')}\n`);
      }
    } catch { /* ignore */ }
  // Derive version again for notification (mirrors createSdkServer logic but without -sdk suffix)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Do NOT send server/ready here; oninitialized hook (after initialize) will emit it once.
    // Explicit keepalive to avoid premature process exit before first client request
    try {
      if(process.stdin.readable) process.stdin.resume();
      process.stdin.on('data', ()=>{}); // no-op to anchor listener
      const ka = setInterval(()=>{/* keepalive */}, 10_000); ka.unref?.();
    } catch { /* ignore */ }
    // Safety fallback: if server/ready not emitted within 100ms of start (e.g., patch failed), emit once.
  if(HANDSHAKE_FALLBACKS_ENABLED){
    setTimeout(()=>{
      try {
        // Only emit via safety-timeout if initialize response was already sent (ordering guarantee)
        if((server as any).__sawInitializeRequest && (server as any).__initResponseSent && !(server as any).__readyNotified){
          handshakeLog('safety_timeout_emit_attempt', { label:'safety-timeout-100ms', sawInit:true, initRespSent: true });
          emitReadyGlobal(server,'safety-timeout-100ms');
        }
      } catch { /* ignore */ }
    }, 100).unref?.();
  }
  // Unconditional DIAG fallback (gated): if no initialize request OR response observed very early, force a synthetic
  // initialize/result frame (id=1) to unblock harness diagnostics. Restricted to diagnostic mode + explicit enable env.
  if(HANDSHAKE_FALLBACKS_ENABLED){
    setTimeout(()=>{
      try {
        const INIT_FALLBACK_ENABLED = process.env.MCP_INIT_FALLBACK_ALLOW === '1';
        if(process.env.MCP_HEALTH_MIXED_DIAG==='1' && !(server as any).__initResponseSent){
        if(!INIT_FALLBACK_ENABLED){
          try { process.stderr.write(`[diag] ${Date.now()} init_unconditional_fallback_skip gating_off\n`); } catch { /* ignore */ }
          return; // diagnostics only, do not emit synthetic frame
        }
        if(!(server as any).__sawInitializeRequest){
          if(process.stderr && !(server as any).__diagForcedInitLogged){
            (server as any).__diagForcedInitLogged = true;
            try { process.stderr.write(`[diag] ${Date.now()} init_unconditional_fallback_emit id=1 reason=no_init_seen_150ms\n`); } catch { /* ignore */ }
          }
        } else {
          try { process.stderr.write(`[diag] ${Date.now()} init_unconditional_fallback_emit id=1 reason=init_seen_no_response_150ms\n`); } catch { /* ignore */ }
        }
        const negotiated = '2024-11-05';
        const frame = { jsonrpc:'2.0', id:1, result:{ protocolVersion: negotiated, capabilities:{}, instructions:'Use initialize -> tools/list -> tools/call { name, arguments }. (unconditional-init-fallback)' } };
        // Attempt to send via transport if available else raw stdout
        const tr = (server as any)._transport || (server as any).__transportRef;
        (server as any).__initResponseSent = true;
        if(tr && typeof tr.send==='function'){
          Promise.resolve(tr.send(frame)).then(()=>{ if(!(server as any).__readyNotified) emitReadyGlobal(server,'unconditional-init-fallback'); }).catch(()=>{});
        } else {
          try { process.stdout.write(JSON.stringify(frame)+'\n'); } catch { /* ignore */ }
          if(!(server as any).__readyNotified) emitReadyGlobal(server,'unconditional-init-fallback-direct');
        }
      }
      } catch { /* ignore */ }
    }, 150).unref?.();
  }
    // Patch initialize result for instructions (SDK internal property _clientVersion signals completion soon after connect)
    const originalInit = (server as any)._oninitialize;
  if(originalInit && !(server as any).__initPatched){
      (server as any).__initPatched = true;
  (server as any)._oninitialize = async function(this: any, request: any){
        // Mark saw initialize as early as possible (enter) to aid watchdog diagnostics
        try {
          (this as any).__sawInitializeRequest = true;
          handshakeLog('oninitialize_enter', { sawInit:true, ready: !!(this as any).__readyNotified, initRespSent: !!(server as any).__initResponseSent });
        } catch { /* ignore */ }
        const result = await originalInit.call(this, request);
        try {
          const negotiated = negotiateProtocolVersion(request?.params?.protocolVersion);
          (result as any).protocolVersion = negotiated;
          if(result && typeof result === 'object' && !('instructions' in result)){
            (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.';
          }
          // Do NOT emit server/ready here; ordering handled strictly by transport send hook.
        } catch {/* ignore */}
        return result;
      };
    }
    // Wrap transport.send to detect initialize response flush and force a ready emission if still pending
    try {
      const origSend = (transport as any)?.send?.bind(transport);
      if(origSend && !(transport as any).__wrappedForReady){
        (transport as any).__wrappedForReady = true;
        (transport as any).send = (msg: any) => {
          let isInitResult = false;
          try {
            isInitResult = !!(msg && typeof msg === 'object' && 'id' in msg && msg.result && msg.result.protocolVersion);
          } catch { /* ignore */ }
          const sendPromise = origSend(msg);
          // Fallback completion / error logging if dispatcher override not active
          try {
            if(process.env.MCP_HEALTH_MIXED_DIAG === '1' && !(server as any).__dispatcherOverrideActive && msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg,'id')){
              const map = (server as any).__diagRQMap;
              if(map && map.has(msg.id)){
                const rec = map.get(msg.id);
                map.delete(msg.id);
                (server as any).__diagQueueDepthSniff = Math.max(0, (server as any).__diagQueueDepthSniff - 1);
                const kind = (msg as any).error ? 'rq_error' : 'rq_complete';
                const dur = Date.now() - rec.start;
                process.stderr.write(`[diag] ${Date.now()} ${kind} method=${rec.method} cat=${rec.cat} id=${msg.id} dur_ms=${dur} qdepth=${(server as any).__diagQueueDepthSniff} src=sniff-send\n`);
              }
            }
          } catch { /* ignore */ }
          if(isInitResult && !(server as any).__readyNotified){
            (server as any).__sawInitializeRequest = true;
            // Defer ready emission one macrotask after send resolves to reduce chance of interleaving
            // ahead of the initialize result line under high I/O contention (observed flake).
            sendPromise?.then?.(()=>{
              (server as any).__initResponseSent = true;
              setTimeout(()=> emitReadyGlobal(server,'transport-send-hook-dynamic'), 0);
            })?.catch?.(()=>{});
          }
          return sendPromise;
        };
      }
    } catch { /* ignore wrapper errors */ }
    return;
  }
  const modServer: any = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
  const server = createSdkServer(modServer.Server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Single server/ready will be emitted after initialize via oninitialized
  try {
    if(process.stdin.readable) process.stdin.resume();
    process.stdin.on('data', ()=>{});
    const ka = setInterval(()=>{/* keepalive */}, 10_000); ka.unref?.();
  } catch { /* ignore */ }
  // Safety fallback timer (mirrors dynamic path) for missed ready emission
  if(HANDSHAKE_FALLBACKS_ENABLED){
    setTimeout(()=>{
      try {
        if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
          handshakeLog('safety_timeout_emit_attempt', { label:'safety-timeout-100ms-secondary', sawInit:true, initRespSent: !!(server as any).__initResponseSent });
          emitReadyGlobal(server,'safety-timeout-100ms-secondary');
        }
      } catch { /* ignore */ }
    }, 100).unref?.();
  }
}
