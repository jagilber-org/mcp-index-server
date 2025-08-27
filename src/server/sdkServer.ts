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

// Supported protocol versions (ordered descending preference – first is default)
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18'];

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
    const v = (server as any).__declaredVersion || (server as any).version || '0.0.0';
    // Mark before sending to avoid re-entrancy; we still attempt best-effort delivery via fallbacks.
    (server as any).__readyNotified = true;
    handshakeLog('ready_emitted', { reason, version: v });
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
    // Always follow with tools/list_changed so clients waiting on tool availability proceed.
    try { if(typeof (server as any).sendToolListChanged === 'function') (server as any).sendToolListChanged(); } catch { /* ignore */ }
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

  // Patch sendToolListChanged early: if an early tools/list_changed would fire before server/ready
  // (observed in tests where tools/list_changed arrives without prior server/ready), force an
  // idempotent ready emission first to satisfy handshake ordering guarantees.
  try {
    const origSendToolListChanged = (server as any).sendToolListChanged?.bind(server);
    if(origSendToolListChanged && !(server as any).__listPatched){
      (server as any).__listPatched = true;
      (server as any).sendToolListChanged = (...args: any[]) => {
        try {
          // If we already emitted ready, just flush any pending list_changed immediately
          if((server as any).__readyNotified){
            if((server as any).__pendingListChanged){ delete (server as any).__pendingListChanged; }
            return origSendToolListChanged(...args);
          }
          // Not ready yet
          const sawInit = !!(server as any).__sawInitializeRequest;
          const initRespSent = !!(server as any).__initResponseSent;
          if(!sawInit){
            // Buffer until initialize observed; avoids emitting ready before initialize (ordering requirement)
            (server as any).__pendingListChanged = true;
            handshakeLog('buffer_list_changed_pre_init');
            return; // drop for now – will be replayed by ready emission
          }
          if(sawInit && !initRespSent){
            // Initialize request seen but response not yet flushed; schedule a microtask after we expect
            // the initialize handler setImmediate to run so ready comes before list_changed.
            if(!(server as any).__pendingListChanged){
              (server as any).__pendingListChanged = true;
              handshakeLog('buffer_list_changed_pre_init_response');
            }
            setTimeout(()=>{
              try {
                if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
                  handshakeLog('pre_list_emit_ready_deferred');
                  emitReadyGlobal(server,'pre-list-changed-after-init');
                }
              } catch { /* ignore */ }
            },0);
            return;
          }
          // Initialize response flushed but ready somehow not emitted; force it now before list_changed
          handshakeLog('pre_list_ready_patch', { reason: 'sendToolListChanged-before-ready' });
          emitReadyGlobal(server,'pre-list-changed-patch');
          // emitReadyGlobal will recurse into this wrapper; second pass will hit the first branch (__readyNotified)
          return;
        } catch { /* ignore */ }
        return origSendToolListChanged(...args);
      };
    }
  } catch { /* ignore patch errors */ }

  // Track ready notification + whether initialize was seen (ordering guarantee)
  (server as any).__readyNotified = false;
  (server as any).__sawInitializeRequest = false;
  // Track when initialize response has been sent (ordering gate for ready)
  (server as any).__initResponseSent = false;

  // (emitReady wrapper removed; ordering now enforced by delaying emission until transport send hook / watchdogs)

  // Post-initialize watchdogs: if initialize observed but ready still not emitted, force an idempotent
  // emission after short delays. We previously gated on __initResponseSent which could suppress all watchdogs
  // if the transport send hook never fired (root cause of missing ready). Ordering risk is minimal since
  // these fire >=120ms after initialize which is well after the tiny initialize handler completes & flushes.
  const watchdogTry = (label: string)=>{
    try {
      if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
        handshakeLog('watchdog_emit_attempt', { label, sawInit: true, initRespSent: !!(server as any).__initResponseSent });
        emitReadyGlobal(server,label);
      } else {
        handshakeLog('watchdog_skip', { label, sawInit: !!(server as any).__sawInitializeRequest, initRespSent: !!(server as any).__initResponseSent, ready: !!(server as any).__readyNotified });
      }
    } catch { /* ignore */ }
  };
  setTimeout(()=> watchdogTry('init-watchdog-120ms'),120).unref?.();
  setTimeout(()=> watchdogTry('init-watchdog-250ms'),250).unref?.();
  // Long-tail safety
  setTimeout(()=> watchdogTry('init-watchdog-500ms'),500).unref?.();

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
  handshakeLog('initialize_received', { requestedProtocol: req?.params?.protocolVersion });
  const requested = req?.params?.protocolVersion as string | undefined;
      const negotiated = negotiateProtocolVersion(requested);
      const versionDeclared = (server as any).__declaredVersion || (server as any).version || '0.0.0';
      const result: any = {
        protocolVersion: negotiated,
        serverInfo: { name: 'mcp-index-server', version: versionDeclared },
        capabilities: { tools: { listChanged: true } },
        instructions: 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.'
      };
  // Schedule an immediate (next tick) ready emission to guarantee deterministic presence.
  // setImmediate runs after I/O events, so the initialize response frame will have flushed first.
  if(!(server as any).__readyNotified){
    handshakeLog('initialize_defer_ready', { strategy:'initialize-handler-setImmediate' });
    setImmediate(()=>{
      try {
        if(!(server as any).__readyNotified){
          (server as any).__initResponseSent = true; // treat as flushed for ordering purposes
          emitReadyGlobal(server,'initialize-handler-immediate');
        }
      } catch { /* ignore */ }
    });
  }
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
  handshakeLog('tools_list_request', { afterReady: !!(server as any).__readyNotified, sawInit: !!(server as any).__sawInitializeRequest });
    const registry = getToolRegistry();
    return { tools: registry.map(r => ({ name: r.name, description: r.description, inputSchema: r.inputSchema as Record<string,unknown> })) };
  });

  // Raw handler for tools/call (MCP style) - returns content array
  server.setRequestHandler(requestSchema('tools/call'), async (req: { params?: { name?: string; arguments?: Record<string, unknown> } }) => {
    const p = req?.params ?? {};
    const name = p.name ?? '';
    const args = p.arguments || {};
  if(name === 'health/check') handshakeLog('tools_call_health');
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
      const msg = e instanceof Error ? e.message : String(e);
      try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] tool_error tool=${name} msg=${msg.replace(/\s+/g,' ')}\n`); } catch { /* ignore */ }
  throw { code: -32603, message: 'Tool execution failed', data: { message: msg, method: name } };
    }
  });

  // Legacy per-tool direct JSON-RPC handlers removed in 1.0.0 (BREAKING CHANGE). Clients must use tools/call.

  // Lightweight ping handler (simple reachability / latency measurement)
  server.setRequestHandler(requestSchema('ping'), async () => {
    // If ready somehow not emitted yet (rare race), emit now (idempotent) to satisfy handshake expectations.
    if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
      emitReadyGlobal(server,'ping-trigger');
    }
    return { timestamp: new Date().toISOString(), uptimeMs: Math.round(process.uptime() * 1000) };
  });

  // (initialize patch no longer required because we supply explicit handler above)

  return server;
}

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
    // Pre-connect stdin sniffer: if we observe an initialize request but downstream logic fails to emit server/ready,
    // schedule a guarded fallback emission (acts at framing layer, independent of SDK internals).
    try {
      if(server && !process.env.MCP_DISABLE_INIT_SNIFF){
        let __sniffBuf = '';
        process.stdin.on('data', (chunk: Buffer) => {
          try {
            __sniffBuf += chunk.toString();
            // Fast substring search instead of full JSON parse (handles partial framing / headers)
            if(!((server as any).__sniffedInit) && /"method"\s*:\s*"initialize"/.test(__sniffBuf)){
              (server as any).__sniffedInit = true;
              // Give primary initialize handlers a short window (ordering response -> ready). Then force if still missing.
              setTimeout(()=>{
                try {
                  (server as any).__sawInitializeRequest = true;
                  if((server as any).__initResponseSent && !(server as any).__readyNotified){
                    emitReadyGlobal(server,'stdin-sniff-fallback');
                  }
                } catch { /* ignore */ }
              }, 60).unref?.();
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
    // Instance-level override of _onrequest to retain error.data
    const originalOnRequest = (server as any)._onrequest?.bind(server);
    if(originalOnRequest){
      (server as any)._onrequest = function(request: any){
    const handler = (this as any)._requestHandlers.get(request.method) ?? (this as any).fallbackRequestHandler;
        if(handler === undefined){
          return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: -32601, message:'Method not found', data:{ method: request.method } }}).catch(()=>{});
        }
        const abortController = new AbortController();
        (this as any)._requestHandlerAbortControllers.set(request.id, abortController);
        Promise.resolve()
          .then(()=> handler(request, { signal: abortController.signal }))
          .then((result:any)=>{
            if(abortController.signal.aborted) return;
            try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] response method=${request.method} id=${request.id} ok\n`); } catch { /* ignore */ }
            const sendPromise = (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, result });
            if(request.method === 'initialize'){
              // After initialize response flush, mark sent and emit ready (deferred to macrotask for ordering).
              (sendPromise?.then?.(()=> { (server as any).__initResponseSent = true; emitReadyGlobal(server,'transport-send-hook'); }))
                ?.catch(()=>{});
            }
            return sendPromise;
          }, (error:any)=>{
            if(abortController.signal.aborted) return;
      try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[rpc] response method=${request.method} id=${request.id} error=${error?.message}\n`); } catch { /* ignore */ }
            return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: Number.isSafeInteger(error?.code)? error.code: -32603, message: error?.message || 'Internal error', data: error?.data } });
          })
          .catch(()=>{})
          .finally(()=>{ (this as any)._requestHandlerAbortControllers.delete(request.id); });
      };
    }
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
  setTimeout(()=>{
    try {
      if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
        handshakeLog('safety_timeout_emit_attempt', { label:'safety-timeout-100ms', sawInit:true, initRespSent: !!(server as any).__initResponseSent });
        emitReadyGlobal(server,'safety-timeout-100ms');
      }
    } catch { /* ignore */ }
  }, 100).unref?.();
    // Patch initialize result for instructions (SDK internal property _clientVersion signals completion soon after connect)
    const originalInit = (server as any)._oninitialize;
    if(originalInit && !(server as any).__initPatched){
      (server as any).__initPatched = true;
      (server as any)._oninitialize = async function(request: any){
        const result = await originalInit.call(this, request);
        try {
          const negotiated = negotiateProtocolVersion(request?.params?.protocolVersion);
          (result as any).protocolVersion = negotiated;
          if(result && typeof result === 'object' && !('instructions' in result)){
            (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.';
          }
          // Ensure a single server/ready emission even if earlier createSdkServer patch did not execute
          (this as any).__sawInitializeRequest = true;
          if(!(this as any).__readyNotified){ (server as any).__initResponseSent = true; emitReadyGlobal(server,'late-oninitialize-patch'); }
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
          if(isInitResult && !(server as any).__readyNotified){
            (server as any).__sawInitializeRequest = true;
            // Emit only after the initialize response has been flushed to preserve ordering.
            sendPromise?.then?.(()=>{
              (server as any).__initResponseSent = true;
              emitReadyGlobal(server,'transport-send-hook-dynamic');
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
  setTimeout(()=>{
    try {
      if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
        handshakeLog('safety_timeout_emit_attempt', { label:'safety-timeout-100ms-secondary', sawInit:true, initRespSent: !!(server as any).__initResponseSent });
        emitReadyGlobal(server,'safety-timeout-100ms-secondary');
      }
    } catch { /* ignore */ }
  }, 100).unref?.();
}
