/**
 * MCP Index Server - Dual Transport Architecture
 * 
 * PRIMARY TRANSPORT - MCP Protocol (stdin/stdout):
 * - JSON-RPC 2.0 over stdio for all MCP client communication
 * - VS Code, Claude, and other MCP clients connect via stdin/stdout only
 * - Process-isolated, no network exposure
 * 
 * SECONDARY TRANSPORT - Admin Dashboard (optional HTTP):
 * - HTTP server on localhost for administrator monitoring
 * - Read-only interface for status, tools, and metrics
 * - Not for MCP client communication - admin use only
 */
// Early stdin buffering (handshake hardening):
// Some fast clients send the initialize frame immediately after spawn. If the
// SDK server's stdin listener isn't attached yet, those bytes can sit without
// a consumer until the listener is registered. In practice we observed cases
// where initialize never produced a response in ~30s test windows. To harden
// the handshake we capture ALL stdin data prior to startSdkServer() completing
// and then re-emit the buffered chunks once the SDK has attached its handlers.
// This ensures spec compliance: an initialize request always yields either a
// success or a version negotiation error – never silent drop.
// Install global stderr log prefix (timestamps, pid, ppid, seq, tid) before any diagnostic output.
import '../services/logPrefix';
// Ensure logger initializes early (file logging environment may auto-resolve)
import '../services/logger';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';
const __earlyInitChunks: Buffer[] = [];
let __earlyInitFirstLogged = false;
let __sdkReady = false;
// Allow opt-out (e.g., diagnostic comparison) via MCP_DISABLE_EARLY_STDIN_BUFFER=1
const __bufferEnabled = !getRuntimeConfig().server.disableEarlyStdinBuffer;
// We attach the temporary listener immediately so even synchronous module load
// time is covered.
function __earlyCapture(chunk: Buffer){
  if(!__sdkReady && __bufferEnabled){
    __earlyInitChunks.push(Buffer.from(chunk));
    // Light diagnostic: log only on first capture & optionally every 10th if deep buffering occurs.
    if(getBooleanEnv('MCP_LOG_DIAG')){
      if(!__earlyInitFirstLogged){
        __earlyInitFirstLogged = true;
        const preview = chunk.toString('utf8').replace(/\r/g,'\\r').replace(/\n/g,'\\n').slice(0,120);
        const hasContentLength = chunk.toString('utf8').includes('Content-Length');
        try { process.stderr.write(`[handshake-buffer] first early chunk captured size=${chunk.length} hasContentLength=${hasContentLength} preview="${preview}"\n`); } catch { /* ignore */ }
      } else if(__earlyInitChunks.length % 10 === 0){
        try { process.stderr.write(`[handshake-buffer] bufferedChunks=${__earlyInitChunks.length}\n`); } catch { /* ignore */ }
      }
    }
  }
}
try { if(__bufferEnabled) process.stdin.on('data', __earlyCapture); } catch { /* ignore */ }

import { listRegisteredMethods } from './registry';
import { startSdkServer } from './sdkServer';
import '../services/handlers.instructions';
import '../services/handlers.search';
// Register unified dispatcher (was missing causing instructions/dispatch tests to timeout)
import '../services/instructions.dispatcher';
import '../services/handlers.integrity';
import '../services/handlers.usage';
import '../services/handlers.prompt';
import '../services/handlers.metrics';
import '../services/handlers.gates';
import '../services/handlers.testPrimitive';
import '../services/handlers.diagnostics';
import '../services/handlers.feedback';
import '../services/handlers.help';
import '../services/handlers.bootstrap';
import { getCatalogState, diagnoseInstructionsDir, startCatalogVersionPoller } from '../services/catalogContext';
import { autoSeedBootstrap } from '../services/seedBootstrap';
import { createDashboardServer } from '../dashboard/server/DashboardServer.js';
import { getMetricsCollector } from '../dashboard/server/MetricsCollector.js';
import { getMemoryMonitor } from '../utils/memoryMonitor';
import { getBooleanEnv } from '../utils/envUtils';
import fs from 'fs';
import path from 'path';
import { logInfo } from '../services/logger';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';
import { emitPreflightAndMaybeExit } from '../services/preflight';

// ---------------------------------------------------------------------------
// Unified global diagnostics guard (installs once) for uncaught errors, promise
// rejections, runtime warnings, and termination signals. Prevents duplicate
// handlers that previously existed in multiple modules and ensures consistent
// structured log prefixes that downstream log processors can key on.
// ---------------------------------------------------------------------------
if(!process.listeners('uncaughtException').some(l => (l as unknown as { name?:string }).name === 'mcpGlobalGuard')){
  const write = (line: string) => { try { process.stderr.write(line + '\n'); } catch { /* ignore */ } };
  const formatErr = (e: unknown) => {
    if(e instanceof Error) return `${e.name||'Error'}: ${e.message} stack=${e.stack?.replace(/\s+/g,' ')}`;
    return typeof e === 'object' ? JSON.stringify(e) : String(e);
  };
  const stamp = () => new Date().toISOString();
  const tag = (t: string) => `[diag] [${stamp()}] [${t}]`;

  const getFatalExitDelayMs = () => Math.max(0, getRuntimeConfig().server.fatalExitDelayMs);
  const graceful = () => setTimeout(() => process.exit(1), getFatalExitDelayMs());

  const uncaughtHandler = function mcpGlobalGuard(err: unknown){
    write(`${tag('uncaught_exception')} ${formatErr(err)}`);
    graceful();
  };
  const rejectionHandler = function mcpGlobalGuard(reason: unknown){
    write(`${tag('unhandled_rejection')} ${formatErr(reason)}`);
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', rejectionHandler);

  // Surface Node.js process warnings (deprecations, experimental flags, etc.)
  process.on('warning', (w: Error) => {
    write(`${tag('process_warning')} ${formatErr(w)}`);
  });

  // Graceful shutdown on common termination signals: log intent then exit(0)
  const sigHandler = (sig: NodeJS.Signals) => {
    write(`${tag('signal')} received=${sig}`);
    setTimeout(() => process.exit(0), 5);
  };
  ['SIGINT','SIGTERM'].forEach(s => { try { process.once(s as NodeJS.Signals, sigHandler); } catch { /* ignore */ } });
}

// Low-level ingress tracing: echo raw stdin frames when verbose enabled (diagnostic only)
try {
  if(getBooleanEnv('MCP_LOG_VERBOSE') && !process.stdin.listenerCount('data')){
    process.stdin.on('data', chunk => {
      try { process.stderr.write(`[in] ${chunk.toString().replace(/\n/g,'\\n')}\n`); } catch { /* ignore */ }
    });
  }
} catch { /* ignore */ }

interface CliConfig {
  dashboard: boolean;
  dashboardPort: number;
  dashboardHost: string;
  maxPortTries: number;
  legacy: boolean; // deprecated flag (ignored)
}

function parseArgs(argv: string[]): CliConfig {
  const runtimeCfg = reloadRuntimeConfig();
  const http = runtimeCfg.dashboard.http;
  const config: CliConfig = {
    dashboard: http.enable,
    dashboardPort: http.port,
    dashboardHost: http.host,
    maxPortTries: http.maxPortTries,
    legacy: false,
  };

  const args = argv.slice(2);
  for(let i=0;i<args.length;i++){
    const raw = args[i];
    if(raw === '--dashboard') config.dashboard = true;
    else if(raw === '--no-dashboard') config.dashboard = false;
    else if(raw.startsWith('--dashboard-port=')) config.dashboardPort = parseInt(raw.split('=')[1],10) || config.dashboardPort;
    else if(raw === '--dashboard-port'){ const v = args[++i]; if(v) config.dashboardPort = parseInt(v,10) || config.dashboardPort; }
    else if(raw.startsWith('--dashboard-host=')) config.dashboardHost = raw.split('=')[1] || config.dashboardHost;
    else if(raw === '--dashboard-host'){ const v = args[++i]; if(v) config.dashboardHost = v; }
    else if(raw.startsWith('--dashboard-tries=')) config.maxPortTries = Math.max(1, parseInt(raw.split('=')[1],10) || config.maxPortTries);
    else if(raw === '--dashboard-tries'){ const v = args[++i]; if(v) config.maxPortTries = Math.max(1, parseInt(v,10) || config.maxPortTries); }
  else if(raw === '--legacy' || raw === '--legacy-transport') config.legacy = true; // no-op
  else if(raw === '--help' || raw === '-h'){
      printHelpAndExit();
    }
  }
  return config;
}

function printHelpAndExit(){
  const help = `mcp-index-server - Model Context Protocol Server

MCP TRANSPORT (Client Communication):
  Primary transport: JSON-RPC 2.0 over stdio (stdin/stdout)
  Purpose: VS Code, Claude, and other MCP clients
  Security: Process-isolated, no network exposure

ADMIN DASHBOARD (Optional):
  --dashboard              Enable read-only admin dashboard (default off)
  --dashboard-port=PORT    Dashboard port (default 8787)
  --dashboard-host=HOST    Dashboard host (default 127.0.0.1)
  --dashboard-tries=N      Port retry attempts (default 10)
  --no-dashboard           Disable dashboard
  Purpose: Local administrator monitoring only

ENVIRONMENT VARIABLES:
  MCP_DASHBOARD=1          Enable dashboard (0=disable, 1=enable)
  MCP_DASHBOARD_PORT=PORT  Dashboard port (default 8787)
  MCP_DASHBOARD_HOST=HOST  Dashboard host (default 127.0.0.1)
  MCP_DASHBOARD_TRIES=N    Port retry attempts (default 10)
  
  Other environment variables:
  MCP_LOG_VERBOSE=1        Verbose RPC/transport logging
  MCP_LOG_DIAG=1           Diagnostic logging
  MCP_ENABLE_MUTATION=1    Enable write operations
  MCP_IDLE_KEEPALIVE_MS    Keepalive interval (default 30000ms)

GENERAL:
  -h, --help               Show this help and exit
  (legacy transport removed; SDK only)

IMPORTANT:
- MCP clients connect via stdio only, not HTTP dashboard
- Dashboard is for admin monitoring, not client communication
- All MCP protocol frames output to stdout; logs to stderr
- Command line arguments override environment variables`;
  // write to stderr to avoid contaminating stdout protocol
  process.stderr.write(help + '\n');
  process.exit(0);
}

function findPackageVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '..', '..', 'package.json')
  ];
  for(const p of candidates){
    try {
      if(fs.existsSync(p)){
        const raw = JSON.parse(fs.readFileSync(p,'utf8'));
        if(raw?.version) return raw.version;
      }
    } catch { /* ignore */ }
  }
  return '0.0.0';
}

// Added close handle in return object for test coverage harness so unit tests can start and stop the dashboard
// without leaving open event loop handles. Production code ignores the extra property.
async function startDashboard(cfg: CliConfig): Promise<{ url: string; close: () => void } | null> {
  if (!cfg.dashboard) return null;

  try {
    process.stderr.write(`[startup] Starting dashboard server on ${cfg.dashboardHost}:${cfg.dashboardPort}\n`);
    
    const dashboardServer = createDashboardServer({
      port: cfg.dashboardPort,
      host: cfg.dashboardHost,
      maxPortTries: cfg.maxPortTries,
      enableWebSockets: true,
      enableCors: false,
    });

    const result = await dashboardServer.start();
    
    // Record dashboard startup in metrics
    getMetricsCollector().recordConnection('dashboard_server');
    
    return {
      url: result.url,
      close: result.close
    };
  } catch (error) {
    process.stderr.write(`[startup] Dashboard startup failed: ${error}\n`);
    return null;
  }
}

export async function main(){
  // Run startup preflight (module/data presence). Non-fatal unless MCP_PREFLIGHT_STRICT=1
  try { emitPreflightAndMaybeExit(); } catch { /* ignore preflight wrapper errors */ }
  // -------------------------------------------------------------
  // Automatic bootstrap seeding (executes before any catalog load)
  // -------------------------------------------------------------
  try { autoSeedBootstrap(); } catch { /* ignore seeding errors (non-fatal) */ }
  // -------------------------------------------------------------
  // Idle keepalive support (multi-client shared server test aid)
  // -------------------------------------------------------------
  // Some test scenarios spawn the index server with stdin set to 'ignore'
  // (child_process stdio option) and then create separate portable clients
  // that each spawn *their own* server processes pointing at the same
  // instructions directory. In that arrangement the originally spawned
  // shared server would exit immediately because no stdin activity occurs
  // (no MCP initialize frame arrives). That premature exit caused RED in
  // the portableCrudMultiClientSharedServer.spec.ts test before any CRUD
  // assertions executed.
  //
  // To accommodate this interim RED/ GREEN progression—while future work
  // may add true multi-attach capabilities—we keep the process alive for
  // a bounded idle window when (a) stdin is not readable OR (b) no stdin
  // activity is observed shortly after startup. Environment variable
  // MCP_IDLE_KEEPALIVE_MS (default 30000) bounds the maximum keepalive.
  // This has negligible overhead and only applies when no initialize
  // handshake occurs promptly.
  let __stdinActivity = false;
  try { if(process.stdin && !process.stdin.destroyed){ process.stdin.on('data', () => { __stdinActivity = true; }); } } catch { /* ignore */ }

  function startIdleKeepalive(){
    const serverConfig = getRuntimeConfig().server;
    const maxMs = Math.max(1000, serverConfig.idleKeepaliveMs);
    const started = Date.now();
    // Only create ONE interval.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if((global as any).__mcpIdleKeepalive) return;
    // Emit a synthetic readiness marker for test environments that spawn the
    // server with stdin=ignore and rely on a '[ready]' sentinel before
    // proceeding (portableCrudMultiClientSharedServer.spec). This does NOT
    // emit a formal JSON-RPC server/ready (which would follow initialize in
    // normal operation); it's a plain log line to stdout and is gated to the
    // idle keepalive path only so production interactive flows are unaffected.
    // Synthetic readiness sentinel (only when explicitly enabled) so tests that rely on a
    // shared server with stdin ignored can proceed. Stricter gating to avoid contaminating
    // other protocol tests: requires MCP_SHARED_SERVER_SENTINEL=1 AND delays emission slightly
    // to allow an initialize frame to arrive first if stdin is active. Legacy env
    // MCP_IDLE_READY_SENTINEL is ignored unless accompanied by MCP_SHARED_SERVER_SENTINEL.
    try {
      if(serverConfig.sharedSentinel === 'multi-client-shared' && !__stdinActivity){
        setTimeout(()=>{ if(!__stdinActivity){ try { process.stdout.write('[ready] idle-keepalive (no stdin activity)\n'); } catch { /* ignore */ } } }, 60);
      }
    } catch { /* ignore */ }
    const iv = setInterval(() => {
      // Clear early if stdin becomes active (late attach) so we don't keep zombie processes.
      if(__stdinActivity || Date.now() - started > maxMs){
        clearInterval(iv);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).__mcpIdleKeepalive = undefined;
      } else if(getRuntimeConfig().server.multicoreTrace){
        try {
          // Reflective access to private diagnostic API (Node internal) guarded defensively
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyProc: any = process as unknown as any;
          const handlesLen = typeof anyProc._getActiveHandles === 'function' ? (anyProc._getActiveHandles()||[]).length : 'n/a';
          process.stderr.write(`[keepalive] t=${Date.now()-started}ms handles=${handlesLen} stdinActivity=${__stdinActivity}\n`);
        } catch { /* ignore */ }
      }
    }, 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__mcpIdleKeepalive = iv;
  }
  // Always start keepalive immediately (unconditional) so a lack of stdin activity
  // cannot allow the event loop to drain and exit before the shared-server test
  // observes the synthetic readiness sentinel. The interval self-clears on first
  // stdin activity or after the bounded max window.
  startIdleKeepalive();

  // Short-circuit handshake mode removed (MCP_SHORTCIRCUIT) now that full
  // protocol framing is stable and locked by tests. (2025-08-31)
  const cfg = parseArgs(process.argv);
  const runtime = getRuntimeConfig();
  const dash = await startDashboard(cfg);
  if(dash){
    process.stderr.write(`[startup] Dashboard server started successfully\n`);
    process.stderr.write(`[startup] Dashboard URL: ${dash.url}\n`);
    process.stderr.write(`[startup] Dashboard host: ${cfg.dashboardHost}\n`);
    process.stderr.write(`[startup] Dashboard port: ${dash.url.split(':').pop()?.replace('/', '') || 'unknown'}\n`);
    process.stderr.write(`[startup] Dashboard WebSockets: enabled\n`);
    process.stderr.write(`[startup] Dashboard access: Local admin interface (not for MCP clients)\n`);
  } else if(cfg.dashboard) {
    process.stderr.write(`[startup] Dashboard enabled but failed to start (check port ${cfg.dashboardPort})\n`);
  } else {
    process.stderr.write(`[startup] Dashboard disabled (set MCP_DASHBOARD=1 to enable)\n`);
  }

  // Initialize memory monitoring if debug mode is enabled
  if (getBooleanEnv('MCP_DEBUG') || getBooleanEnv('MCP_MEMORY_MONITOR')) {
    try {
      const memMonitor = getMemoryMonitor();
      memMonitor.startMonitoring(10000); // Monitor every 10 seconds
      process.stderr.write(`[startup] Memory monitoring enabled (interval: 10s)\n`);
      process.stderr.write(`[startup] Memory monitor commands: memStatus(), startMemWatch(), stopMemWatch(), memReport(), forceGC(), checkListeners()\n`);
    } catch (error) {
      process.stderr.write(`[startup] Memory monitoring failed: ${error}\n`);
    }
  }

  // Extended startup diagnostics (does not emit on stdout)
  if(runtime.logging.verbose || runtime.logging.diagnostics){
    try {
      const methods = listRegisteredMethods();
      // Force catalog load to report initial count/hash
      const catalog = getCatalogState();
      const mutation = runtime.mutationEnabled;
      const dirDiag = diagnoseInstructionsDir();
      process.stderr.write(`[startup] toolsRegistered=${methods.length} mutationEnabled=${mutation} catalogCount=${catalog.list.length} catalogHash=${catalog.hash} instructionsDir="${dirDiag.dir}" exists=${dirDiag.exists} writable=${dirDiag.writable}${dirDiag.error?` dirError=${dirDiag.error.replace(/\s+/g,' ')}`:''}\n`);
      try {
        const { summarizeTraceEnv } = await import('../services/tracing.js');
        const sum = summarizeTraceEnv();
        process.stderr.write(`[startup] trace level=${sum.level} session=${sum.session} file=${sum.file||'none'} categories=${sum.categories?sum.categories.join(','):'*'} maxFileSize=${sum.maxFileSize||0} rotationIndex=${sum.rotationIndex}\n`);
      } catch { /* ignore */ }
    } catch(e){
      process.stderr.write(`[startup] diagnostics_error ${(e instanceof Error)? e.message: String(e)}\n`);
    }
  }
  if(__bufferEnabled && runtime.logging.diagnostics){
    try {
      const totalBytes = __earlyInitChunks.reduce((sum, c) => sum + c.length, 0);
      const hasContentLength = __earlyInitChunks.some(c => c.toString('utf8').includes('Content-Length'));
      process.stderr.write(`[handshake-buffer] pre-start buffered=${__earlyInitChunks.length} totalBytes=${totalBytes} hasContentLength=${hasContentLength}\n`);
    } catch { /* ignore */ }
  }
  await startSdkServer();
  // Auto-confirm bootstrap (test harness opt-in). Executed after SDK start so catalog state
  // exists; harmless if already confirmed or non-bootstrap instructions present.
  try {
    if(runtime.server.bootstrap.autoconfirm){
      const ok = forceBootstrapConfirmForTests('auto-confirm env');
      if(ok && runtime.logging.diagnostics){ try { process.stderr.write('[bootstrap] auto-confirm applied (test env)\n'); } catch { /* ignore */ } }
    }
  } catch { /* ignore */ }
  // Start cross-instance catalog version poller unless disabled.
  try {
    // Poller now opt-in to avoid introducing timing variance into deterministic
    // visibility & manifest repair tests. Enable with MCP_ENABLE_CATALOG_POLLER=1.
    if(runtime.server.catalogPolling.enabled){
      startCatalogVersionPoller({
        proactive: runtime.server.catalogPolling.proactive,
        intervalMs: runtime.server.catalogPolling.intervalMs,
      });
      if(runtime.logging.diagnostics){ try { process.stderr.write(`[startup] catalog version poller started proactive=${runtime.server.catalogPolling.proactive}\n`); } catch { /* ignore */ } }
    } else if(runtime.logging.diagnostics) {
      try { process.stderr.write('[startup] catalog version poller not enabled (set MCP_ENABLE_CATALOG_POLLER=1)\n'); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // Mark SDK ready & replay any buffered stdin chunks exactly once.
  __sdkReady = true;
  if(__bufferEnabled){
    try { process.stdin.off('data', __earlyCapture); } catch { /* ignore */ }
    if(__earlyInitChunks.length){
      const totalBytes = __earlyInitChunks.reduce((sum, c) => sum + c.length, 0);
      const hasContentLength = __earlyInitChunks.some(c => c.toString('utf8').includes('Content-Length'));
      const hasInitialize = __earlyInitChunks.some(c => c.toString('utf8').includes('"method"') && c.toString('utf8').includes('initialize'));
      if(runtime.logging.diagnostics){
        try {
          process.stderr.write(`[handshake-buffer] replay starting chunks=${__earlyInitChunks.length} totalBytes=${totalBytes} hasContentLength=${hasContentLength} hasInitialize=${hasInitialize}\n`);
        } catch { /* ignore */ }
      }
      try {
        for(let i = 0; i < __earlyInitChunks.length; i++){
          const c = __earlyInitChunks[i];
          process.stdin.emit('data', c);
          if(runtime.logging.diagnostics && i === 0){
            const preview = c.toString('utf8').replace(/\r/g,'\\r').replace(/\n/g,'\\n').slice(0,200);
            try { process.stderr.write(`[handshake-buffer] replayed chunk[0] size=${c.length} preview="${preview}"\n`); } catch { /* ignore */ }
          }
        }
      } catch(e) {
        if(runtime.logging.diagnostics){
          try { process.stderr.write(`[handshake-buffer] replay error: ${(e instanceof Error) ? e.message : String(e)}\n`); } catch { /* ignore */ }
        }
      }
      // eslint-disable-next-line no-console
      if(runtime.logging.diagnostics) console.error(`[handshake-buffer] replayed ${__earlyInitChunks.length} early chunk(s)`);
      __earlyInitChunks.length = 0;
    } else if(runtime.logging.diagnostics){
      try { process.stderr.write(`[handshake-buffer] replay skipped (no buffered chunks)\n`); } catch { /* ignore */ }
    }
  }
  process.stderr.write('[startup] SDK server started (stdio only)\n');
  try { logInfo('server_started', { pid: process.pid, logFile: runtime.logging.file }); } catch { /* ignore */ }
}

if(require.main === module){
  main();
}

// Test-only named exports for coverage of argument parsing & dashboard logic
export { parseArgs as _parseArgs, findPackageVersion as _findPackageVersion, startDashboard as _startDashboard };

// Public export for dashboard functionality
export { startDashboard };
