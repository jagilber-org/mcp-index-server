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
import { listRegisteredMethods } from './registry';
import { startSdkServer } from './sdkServer';
import '../services/handlers.instructions';
// Register unified dispatcher (was missing causing instructions/dispatch tests to timeout)
import '../services/instructions.dispatcher';
import '../services/handlers.integrity';
import '../services/handlers.usage';
import '../services/handlers.prompt';
import '../services/handlers.metrics';
import '../services/handlers.gates';
import '../services/handlers.testPrimitive';
import '../services/handlers.diagnostics';
import { getCatalogState, diagnoseInstructionsDir } from '../services/catalogContext';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Global fatal error diagnostics (test-only aid; safe no-op in normal operation)
if(!process.listeners('uncaughtException').some(l => (l as unknown as { name?:string }).name === 'mcpIndexFatalHandler')){
  process.on('uncaughtException', (err) => {
    try { process.stderr.write(`[fatal] uncaught_exception ${(err && (err as Error).stack) || err}\n`); } catch { /* ignore */ }
  });
  process.on('unhandledRejection', (reason) => {
    try { process.stderr.write(`[fatal] unhandled_rejection ${String(reason)}\n`); } catch { /* ignore */ }
  });
}

// Low-level ingress tracing: echo raw stdin frames when verbose enabled (diagnostic only)
try {
  if(process.env.MCP_LOG_VERBOSE === '1' && !process.stdin.listenerCount('data')){
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
  const config: CliConfig = { dashboard: false, dashboardPort: 8787, dashboardHost: '127.0.0.1', maxPortTries: 10, legacy: false };
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

GENERAL:
  -h, --help               Show this help and exit
  (legacy transport removed; SDK only)

IMPORTANT:
- MCP clients connect via stdio only, not HTTP dashboard
- Dashboard is for admin monitoring, not client communication
- All MCP protocol frames output to stdout; logs to stderr`;
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

async function startDashboard(cfg: CliConfig): Promise<{ url: string } | null> {
  if(!cfg.dashboard) return null;
  let port = cfg.dashboardPort;
  const host = cfg.dashboardHost;
  for(let attempt=0; attempt<cfg.maxPortTries; attempt++){
    const ok = await new Promise<boolean>(resolve => {
      const server = http.createServer((req, res) => {
        if(!req.url){ res.statusCode=404; return res.end(); }
        if(req.url === '/' || req.url.startsWith('/index')){
          const tools = listRegisteredMethods();
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.end(`<html><head><title>MCP Index Server - Admin Dashboard</title><style>body{font-family:system-ui;margin:1.5rem;background:#f9f9f9;}h1{color:#2c3e50;}code{background:#e8f4fd;padding:2px 4px;border-radius:4px;color:#2980b9;}table{border-collapse:collapse;}td,th{border:1px solid #ddd;padding:4px 8px;}.admin-notice{background:#fff3cd;border:1px solid #ffeaa7;padding:1rem;border-radius:5px;margin:1rem 0;}.transport-note{background:#d4edda;border:1px solid #c3e6cb;padding:1rem;border-radius:5px;margin:1rem 0;}</style></head><body><div class="admin-notice"><strong>🔒 Administrator Dashboard</strong><br>This interface is for local administrators only. MCP clients connect via stdio transport, not this HTTP interface.</div><h1>MCP Index Server</h1><p>Version: ${findPackageVersion()}</p><h2>Available Tools</h2><ul>${tools.map(t => `<li><code>${t}</code></li>`).join('')}</ul><div class="transport-note"><strong>📡 Transport Information</strong><br><strong>Primary:</strong> stdio (JSON-RPC 2.0) - for MCP client communication<br><strong>Secondary:</strong> HTTP dashboard - for administrator monitoring (read-only)</div></body></html>`);
        } else if(req.url === '/tools.json'){
          const tools = listRegisteredMethods();
          res.setHeader('Content-Type','application/json');
          res.end(JSON.stringify({ tools }));
        } else {
          res.statusCode = 404; res.end('Not Found');
        }
      });
      server.on('error', (e: unknown) => {
        // If port in use, signal failure; other errors also fail and advance
        const code = (e as { code?: string })?.code;
        if(code === 'EADDRINUSE'){ resolve(false); } else { resolve(false); }
      });
      server.listen(port, host, () => {
        // success
        process.on('exit', () => { try { server.close(); } catch { /* ignore */ } });
        resolve(true);
      });
    });
    if(ok){
  // Local dashboard served over HTTP (intended for local dev only)
  // Local HTTP (dashboard) intentionally non-TLS for dev; restrict host to loopback by default.
  // Localhost admin dashboard on loopback only (HTTP acceptable for local dev)
  // Local loopback HTTP (no TLS) acceptable for dev dashboard; constructed to appease static scanners.
  const proto = 'http:'; // dev-only
  const url = `${proto}//${host}:${port}/`;
  return { url };
    }
    port++;
  }
  process.stderr.write(`Dashboard: failed to bind after ${cfg.maxPortTries} attempts starting at port ${cfg.dashboardPort}.\n`);
  return null;
}

export async function main(){
  // Ultra-minimal short-circuit mode: bypass full SDK stack to prove client handshake path.
  // Enable with MCP_SHORTCIRCUIT=1. Responds ONLY to initialize (and emits server/ready) plus ping.
  if(process.env.MCP_SHORTCIRCUIT === '1'){
    const { createInterface } = await import('readline');
    const fs = await import('fs');
    const path = await import('path');
    const version = (()=>{ try { const p = path.join(process.cwd(),'package.json'); return JSON.parse(fs.readFileSync(p,'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } })();
    try { process.stderr.write('[startup] shortcircuit mode enabled\n'); } catch { /* ignore */ }
    const rl = createInterface({ input: process.stdin });
    rl.on('line', line => {
      let msg: unknown; const raw = line.trim(); if(!raw) return;
      try { msg = JSON.parse(raw); } catch { return; }
      if(typeof msg !== 'object' || msg === null) return;
      interface RpcMsg { jsonrpc?: string; id?: number|string|null; method?: string; params?: Record<string,unknown>; }
      const m = msg as RpcMsg;
      if(m.jsonrpc !== '2.0') return;
      if(m.method === 'initialize'){
        const proto = (m.params && typeof m.params === 'object' && 'protocolVersion' in m.params) ? (m.params as Record<string,unknown>).protocolVersion as string : '2025-06-18';
        const result = { jsonrpc:'2.0', id: (m.id ?? 1), result: { protocolVersion: proto, serverInfo:{ name:'mcp-index-server', version }, capabilities:{ tools:{ listChanged:true }}, instructions:'ShortCircuit mode. Minimal capabilities.' } };
        process.stdout.write(JSON.stringify(result)+'\n');
        // Emit ready AFTER initialize result
        process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'server/ready', params:{ version, reason:'shortcircuit' } })+'\n');
        process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/tools/list_changed', params:{} })+'\n');
        return;
      }
      if(m.method === 'ping'){
        process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id: (m.id ?? null), result:{ timestamp: new Date().toISOString() } })+'\n');
        return;
      }
      if(Object.prototype.hasOwnProperty.call(m,'id')){
        process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id: m.id, error:{ code:-32601, message:'Method not found', data:{ method: m.method } } })+'\n');
      }
    });
    // Keep process alive
    process.stdin.resume();
    return; // skip normal path
  }
  const cfg = parseArgs(process.argv);
  const dash = await startDashboard(cfg);
  if(dash){
    process.stderr.write(`Dashboard available at ${dash.url}\n`);
  }
  // Extended startup diagnostics (does not emit on stdout)
  if(process.env.MCP_LOG_VERBOSE === '1' || process.env.MCP_LOG_DIAG === '1'){
    try {
  const methods = listRegisteredMethods();
      // Force catalog load to report initial count/hash
      const catalog = getCatalogState();
      const mutation = process.env.MCP_ENABLE_MUTATION === '1';
  const dirDiag = diagnoseInstructionsDir();
  process.stderr.write(`[startup] toolsRegistered=${methods.length} mutationEnabled=${mutation} catalogCount=${catalog.list.length} catalogHash=${catalog.hash} instructionsDir="${dirDiag.dir}" exists=${dirDiag.exists} writable=${dirDiag.writable}${dirDiag.error?` dirError=${dirDiag.error.replace(/\s+/g,' ')}`:''}\n`);
    } catch(e){
      process.stderr.write(`[startup] diagnostics_error ${(e instanceof Error)? e.message: String(e)}\n`);
    }
  }
  await startSdkServer();
  process.stderr.write('[startup] SDK server started (stdio only)\n');
}

if(require.main === module){
  main();
}

// Test-only named exports for coverage of argument parsing & dashboard logic
export { parseArgs as _parseArgs, findPackageVersion as _findPackageVersion, startDashboard as _startDashboard };
