import { startTransport, listRegisteredMethods } from './transport';
import '../services/toolHandlers';
import http from 'http';
import fs from 'fs';
import path from 'path';

interface CliConfig {
  dashboard: boolean;
  dashboardPort: number;
  dashboardHost: string;
  maxPortTries: number;
}

function parseArgs(argv: string[]): CliConfig {
  const config: CliConfig = { dashboard: false, dashboardPort: 8787, dashboardHost: '127.0.0.1', maxPortTries: 10 };
  for(const raw of argv.slice(2)){
    if(raw === '--dashboard') config.dashboard = true;
    else if(raw === '--no-dashboard') config.dashboard = false;
    else if(raw.startsWith('--dashboard-port=')) config.dashboardPort = parseInt(raw.split('=')[1],10) || config.dashboardPort;
    else if(raw.startsWith('--dashboard-host=')) config.dashboardHost = raw.split('=')[1] || config.dashboardHost;
    else if(raw.startsWith('--dashboard-tries=')) config.maxPortTries = Math.max(1, parseInt(raw.split('=')[1],10) || config.maxPortTries);
    else if(raw === '--help' || raw === '-h'){
      printHelpAndExit();
    }
  }
  return config;
}

function printHelpAndExit(){
  const help = `mcp-index-server\n\nFlags:\n  --dashboard              Enable read-only dashboard (default off)\n  --dashboard-port=PORT    Desired dashboard port (default 8787)\n  --dashboard-host=HOST    Host/interface to bind (default 127.0.0.1)\n  --dashboard-tries=N      Additional incremental ports to try if in use (default 10)\n  --no-dashboard           Disable dashboard even if previous flag set\n  -h, --help               Show this help and exit\n\nTransport: stdio (JSON-RPC line-delimited).\nOutputs only JSON protocol frames to stdout; logs & dashboard URL go to stderr.`;
  // write to stderr to avoid contaminating stdout protocol
  process.stderr.write(help + '\n');
  process.exit(0);
}

function findPackageVersion(): string {
  try {
    const p = path.join(process.cwd(), 'package.json');
    const raw = JSON.parse(fs.readFileSync(p,'utf8')); return raw.version || '0.0.0';
  } catch { return '0.0.0'; }
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
            res.end(`<html><head><title>MCP Index Server</title><style>body{font-family:system-ui;margin:1.5rem;}code{background:#f2f2f2;padding:2px 4px;border-radius:4px;}table{border-collapse:collapse;}td,th{border:1px solid #ddd;padding:4px 8px;}</style></head><body><h1>MCP Index Server</h1><p>Version: ${findPackageVersion()}</p><h2>Tools</h2><ul>${tools.map(t => `<li><code>${t}</code></li>`).join('')}</ul><p>Transport: stdio (JSON-RPC 2.0). This dashboard is read-only.</p></body></html>`);
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
  return { url: `http://${host}:${port}/` };
    }
    port++;
  }
  process.stderr.write(`Dashboard: failed to bind after ${cfg.maxPortTries} attempts starting at port ${cfg.dashboardPort}.\n`);
  return null;
}

export async function main(){
  const cfg = parseArgs(process.argv);
  const dash = await startDashboard(cfg);
  if(dash){
    process.stderr.write(`Dashboard available at ${dash.url}\n`);
  }
  startTransport();
}

if(require.main === module){
  main();
}
