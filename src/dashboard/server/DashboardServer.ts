/**
 * DashboardServer - Phase 1 Dashboard Foundation
 * 
 * Enhanced Express.js server for the MCP Index Server dashboard.
 * Integrates metrics collection, WebSocket communication, and API routes.
 */

import express, { Express } from 'express';
import { Server as HttpServer, createServer } from 'http';
import path from 'path';
import { getMetricsCollector } from './MetricsCollector.js';
import { getWebSocketManager } from './WebSocketManager.js';
import createApiRoutes from './ApiRoutes.js';

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  enableWebSockets?: boolean;
  enableCors?: boolean;
  staticPath?: string;
  maxPortTries?: number;
}

export interface DashboardServerResult {
  url: string;
  port: number;
  close: () => void;
}

export class DashboardServer {
  private app: Express;
  private server: HttpServer | null = null;
  private options: Required<DashboardServerOptions>;
  private metricsCollector = getMetricsCollector();
  private webSocketManager = getWebSocketManager();

  constructor(options: DashboardServerOptions = {}) {
    this.options = {
      port: options.port ?? 8787,
      host: options.host ?? '127.0.0.1',
      enableWebSockets: options.enableWebSockets ?? true,
      enableCors: options.enableCors ?? false,
      staticPath: options.staticPath ?? path.join(__dirname, '../client'),
      maxPortTries: options.maxPortTries ?? 10,
    };

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<DashboardServerResult> {
    let port = this.options.port;
    const host = this.options.host;

    for (let attempt = 0; attempt < this.options.maxPortTries; attempt++) {
      try {
        const result = await this.tryStartServer(host, port);
        return result;
      } catch (error) {
        if ((error as { code?: string })?.code === 'EADDRINUSE') {
          port++;
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to start dashboard server after ${this.options.maxPortTries} attempts`);
  }

  /**
   * Stop the dashboard server
   */
  stop(): void {
    if (this.webSocketManager) {
      this.webSocketManager.close();
    }

    if (this.metricsCollector) {
      this.metricsCollector.stop();
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Get current server info
   */
  getServerInfo(): { port: number; host: string; url: string } | null {
    if (!this.server || !this.server.listening) {
      return null;
    }

    const address = this.server.address();
    if (!address || typeof address !== 'object') {
      return null;
    }

    return {
      port: address.port,
      host: this.options.host,
      url: `http://${this.options.host}:${address.port}/`,
    };
  }

  private async tryStartServer(host: string, port: number): Promise<DashboardServerResult> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      // Initialize WebSocket server if enabled
      if (this.options.enableWebSockets) {
        this.webSocketManager.initialize(this.server);
      }

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(port, host, () => {
        const actualPort = port === 0 ? 
          ((this.server!.address() as { port: number })?.port || port) : port;
        // Local HTTP (dashboard) intentionally non-TLS for dev; restrict host to loopback by default.
        const proto = 'http:'; // dev-only
        const url = `${proto}//${host}:${actualPort}/`;

        // Setup graceful shutdown
        process.on('exit', () => {
          this.stop();
        });

        resolve({
          url,
          port: actualPort,
          close: () => this.stop(),
        });
      });
    });
  }

  private setupMiddleware(): void {
    // Trust proxy (for reverse proxy setups)
    this.app.set('trust proxy', 1);

    // Security headers
    this.app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });

    // Request logging
    this.app.use((req, _res, next) => {
      console.log(`[Dashboard] ${req.method} ${req.url}`);
      next();
    });

    // Static file serving
    if (this.options.staticPath) {
      this.app.use(express.static(this.options.staticPath));
    }

    // JSON body parser
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  }

  private setupRoutes(): void {
    // API routes
    this.app.use('/api', createApiRoutes({
      enableCors: this.options.enableCors,
    }));

    // Root route - enhanced dashboard
    this.app.get('/', (_req, res) => {
      res.send(this.generateDashboardHtml());
    });

    // Legacy routes for backward compatibility
    this.app.get('/index.html', (_req, res) => {
      res.redirect('/');
    });

    // Tools JSON endpoint for legacy compatibility
    this.app.get('/tools.json', async (_req, res) => {
      try {
        // Local HTTP (dashboard) intentionally non-TLS for dev; restrict host to loopback by default.
        const proto = 'http:'; // dev-only
        const response = await fetch(`${proto}//${this.options.host}:${this.getServerInfo()?.port}/api/tools`);
        const data = await response.json() as { tools: Array<{ name: string }> };
        res.json({ tools: data.tools.map(t => t.name) });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tools' });
      }
    });

    // 404 handler
    this.app.use((_req, res) => {
      res.status(404).send('<h1>404 - Page Not Found</h1><p>Return to <a href="/">Dashboard</a></p>');
    });
  }

  private generateDashboardHtml(): string {
    const snapshot = this.metricsCollector.getCurrentSnapshot();
    const webSocketUrl = this.options.enableWebSockets ? 
      `ws://${this.options.host}:${this.getServerInfo()?.port}/ws` : null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Index Server - Enhanced Dashboard</title>
    <style>
        :root {
            --primary-color: #2c3e50;
            --secondary-color: #3498db;
            --success-color: #27ae60;
            --warning-color: #f39c12;
            --danger-color: #e74c3c;
            --bg-color: #f8f9fa;
            --card-bg: #ffffff;
            --border-color: #dee2e6;
            --text-primary: #2c3e50;
            --text-secondary: #6c757d;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            line-height: 1.6;
        }

        .header {
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            color: white;
            padding: 1.5rem 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .header h1 {
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .header .subtitle {
            opacity: 0.9;
            font-size: 1.1rem;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .status-card {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 4px 15px rgba(0,0,0,0.08);
            border: 1px solid var(--border-color);
            transition: transform 0.2s ease;
        }

        .status-card:hover {
            transform: translateY(-2px);
        }

        .status-card h3 {
            color: var(--text-secondary);
            font-size: 0.9rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
        }

        .status-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary-color);
        }

        .status-online { color: var(--success-color); }
        .status-warning { color: var(--warning-color); }
        .status-error { color: var(--danger-color); }

        .tools-section {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 4px 15px rgba(0,0,0,0.08);
            border: 1px solid var(--border-color);
        }

        .tools-section h2 {
            margin-bottom: 1.5rem;
            color: var(--primary-color);
        }

        .tools-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1rem;
        }

        .tool-item {
            background: var(--bg-color);
            border-radius: 8px;
            padding: 1rem;
            border: 1px solid var(--border-color);
        }

        .tool-name {
            font-family: 'Monaco', 'Courier New', monospace;
            font-weight: 600;
            color: var(--secondary-color);
            margin-bottom: 0.5rem;
        }

        .tool-metrics {
            font-size: 0.9rem;
            color: var(--text-secondary);
        }

        .websocket-status {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--card-bg);
            border-radius: 8px;
            padding: 0.75rem 1rem;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            border: 1px solid var(--border-color);
            font-size: 0.9rem;
        }

        .ws-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 0.5rem;
        }

        .ws-connected { background-color: var(--success-color); }
        .ws-disconnected { background-color: var(--danger-color); }
        .ws-connecting { background-color: var(--warning-color); }

        @media (max-width: 768px) {
            .container { padding: 1rem; }
            .status-grid { grid-template-columns: 1fr; }
            .tools-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 MCP Index Server</h1>
        <div class="subtitle">Enhanced Dashboard v2.0 - Real-time Monitoring</div>
    </div>

    <div class="container">
        <div class="status-grid" id="statusGrid">
            <div class="status-card">
                <h3>Server Status</h3>
                <div class="status-value status-online" id="serverStatus">● ONLINE</div>
            </div>
            <div class="status-card">
                <h3>Version</h3>
                <div class="status-value" id="serverVersion">${snapshot.server.version}</div>
            </div>
            <div class="status-card">
                <h3>Uptime</h3>
                <div class="status-value" id="serverUptime">${this.formatUptime(snapshot.server.uptime)}</div>
            </div>
            <div class="status-card">
                <h3>Active Tools</h3>
                <div class="status-value" id="toolCount">${Object.keys(snapshot.tools).length}</div>
            </div>
            <div class="status-card">
                <h3>Success Rate</h3>
                <div class="status-value status-online" id="successRate">${snapshot.performance.successRate.toFixed(1)}%</div>
            </div>
            <div class="status-card">
                <h3>Avg Response</h3>
                <div class="status-value" id="avgResponse">${snapshot.performance.avgResponseTime.toFixed(0)}ms</div>
            </div>
        </div>

        <div class="tools-section">
            <h2>📋 Registered Tools</h2>
            <div class="tools-grid" id="toolsGrid">
                <!-- Tools will be populated here -->
            </div>
        </div>
    </div>

    ${webSocketUrl ? `
    <div class="websocket-status" id="wsStatus">
        <span class="ws-indicator ws-connecting" id="wsIndicator"></span>
        <span id="wsText">Connecting...</span>
    </div>

    <script>
        // WebSocket connection for real-time updates
        let ws = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;

        function connectWebSocket() {
            try {
                ws = new WebSocket('${webSocketUrl}');
                
                ws.onopen = function() {
                    console.log('[Dashboard] WebSocket connected');
                    reconnectAttempts = 0;
                    updateWebSocketStatus('connected', 'Connected');
                };

                ws.onmessage = function(event) {
                    try {
                        const message = JSON.parse(event.data);
                        handleWebSocketMessage(message);
                    } catch (error) {
                        console.error('[Dashboard] Invalid WebSocket message:', error);
                    }
                };

                ws.onclose = function() {
                    console.log('[Dashboard] WebSocket disconnected');
                    updateWebSocketStatus('disconnected', 'Disconnected');
                    
                    // Attempt reconnection
                    if (reconnectAttempts < maxReconnectAttempts) {
                        reconnectAttempts++;
                        setTimeout(connectWebSocket, 2000 * reconnectAttempts);
                    }
                };

                ws.onerror = function(error) {
                    console.error('[Dashboard] WebSocket error:', error);
                    updateWebSocketStatus('disconnected', 'Error');
                };
            } catch (error) {
                console.error('[Dashboard] Failed to create WebSocket:', error);
                updateWebSocketStatus('disconnected', 'Failed');
            }
        }

        function updateWebSocketStatus(status, text) {
            const indicator = document.getElementById('wsIndicator');
            const statusText = document.getElementById('wsText');
            
            indicator.className = 'ws-indicator ws-' + status;
            statusText.textContent = text;
        }

        function handleWebSocketMessage(message) {
            switch (message.type) {
                case 'metrics_update':
                    updateDashboard(message.data);
                    break;
                case 'welcome':
                    console.log('[Dashboard] Welcome message:', message.data);
                    break;
                default:
                    console.log('[Dashboard] Unknown message type:', message.type);
            }
        }

        function updateDashboard(metrics) {
            // Update status cards
            document.getElementById('serverUptime').textContent = formatUptime(metrics.server.uptime);
            document.getElementById('toolCount').textContent = Object.keys(metrics.tools).length;
            document.getElementById('successRate').textContent = metrics.performance.successRate.toFixed(1) + '%';
            document.getElementById('avgResponse').textContent = metrics.performance.avgResponseTime.toFixed(0) + 'ms';
            
            // Update tools grid if needed
            updateToolsGrid(metrics.tools);
        }

        function updateToolsGrid(tools) {
            const grid = document.getElementById('toolsGrid');
            grid.innerHTML = '';
            
            Object.entries(tools).forEach(([name, metrics]) => {
                const toolDiv = document.createElement('div');
                toolDiv.className = 'tool-item';
                toolDiv.innerHTML = \`
                    <div class="tool-name">\${name}</div>
                    <div class="tool-metrics">
                        Calls: \${metrics.callCount} | 
                        Success: \${metrics.successCount} | 
                        Errors: \${metrics.errorCount}
                    </div>
                \`;
                grid.appendChild(toolDiv);
            });
        }

        function formatUptime(ms) {
            const seconds = Math.floor(ms / 1000);
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            
            if (days > 0) return \`\${days}d \${hours}h \${minutes}m\`;
            if (hours > 0) return \`\${hours}h \${minutes}m\`;
            return \`\${minutes}m \${seconds % 60}s\`;
        }

        // Initialize WebSocket connection
        connectWebSocket();

        // Initial tools load
        fetch('/api/tools')
            .then(response => response.json())
            .then(data => {
                const toolsMap = {};
                data.tools.forEach(tool => {
                    toolsMap[tool.name] = tool.metrics;
                });
                updateToolsGrid(toolsMap);
            })
            .catch(error => console.error('[Dashboard] Failed to load tools:', error));
    </script>
    ` : ''}
</body>
</html>`;
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
  }
}

export default DashboardServer;
