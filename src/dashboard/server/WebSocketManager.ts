/**
 * WebSocketManager - Phase 1 Dashboard Foundation
 * 
 * Manages WebSocket connections for real-time dashboard updates.
 * Provides bidirectional communication between dashboard clients and server.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { MetricsSnapshot, getMetricsCollector } from './MetricsCollector.js';

export interface DashboardMessage {
  type: string;
  timestamp: number;
  data?: unknown;
}

export interface MetricsUpdateMessage extends DashboardMessage {
  type: 'metrics_update';
  data: MetricsSnapshot;
}

export interface ToolCallMessage extends DashboardMessage {
  type: 'tool_call';
  data: {
    toolName: string;
    success: boolean;
    responseTime: number;
    clientId?: string;
    errorType?: string;
  };
}

export interface ClientConnectMessage extends DashboardMessage {
  type: 'client_connect';
  data: {
    clientId: string;
    timestamp: number;
  };
}

export interface ClientDisconnectMessage extends DashboardMessage {
  type: 'client_disconnect';
  data: {
    clientId: string;
    timestamp: number;
    duration: number;
  };
}

export interface ErrorMessage extends DashboardMessage {
  type: 'error';
  data: {
    message: string;
    stack?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
}

export interface GenericMessage extends DashboardMessage {
  type: 'welcome' | 'pong' | 'subscribed';
  data?: unknown;
}

// Streaming synthetic activity trace message (live per-call updates)
export interface SyntheticTraceMessage extends DashboardMessage {
  type: 'synthetic_trace';
  data: {
    runId: string;
    seq: number;
    total?: number; // iterations requested (optional)
    method: string;
    success: boolean;
    durationMs: number;
    started: number;
    ended: number;
    error?: string;
    skipped?: boolean;
  };
}

export type DashboardEventMessage = 
  | MetricsUpdateMessage
  | ToolCallMessage
  | ClientConnectMessage
  | ClientDisconnectMessage
  | ErrorMessage
  | GenericMessage
  | SyntheticTraceMessage;

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
  clientId?: string;
  connectedAt?: number;
}

export interface WebSocketManagerOptions {
  path?: string;
  maxConnections?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<ExtendedWebSocket> = new Set();
  private options: Required<WebSocketManagerOptions>;
  private pingTimer?: NodeJS.Timeout;

  constructor(options: WebSocketManagerOptions = {}) {
    this.options = {
      path: options.path ?? '/ws',
      maxConnections: options.maxConnections ?? 100,
      pingInterval: options.pingInterval ?? 30000, // 30 seconds
      pongTimeout: options.pongTimeout ?? 5000, // 5 seconds
    };
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server: HttpServer): void {
    this.wss = new WebSocketServer({
      server,
      path: this.options.path,
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws as ExtendedWebSocket);
    });

    this.wss.on('error', (error: Error) => {
      console.error('[WebSocket] Server error:', error);
    });

    // Start ping/pong heartbeat
    this.startHeartbeat();

    console.log(`[WebSocket] Server initialized on path ${this.options.path}`);
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: DashboardEventMessage): void {
    if (this.clients.size === 0) return;

    const payload = JSON.stringify(message);
    const deadClients: WebSocket[] = [];

    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (error) {
          console.error('[WebSocket] Send error:', error);
          deadClients.push(ws);
        }
      } else {
        deadClients.push(ws);
      }
    });

    // Clean up dead connections
    deadClients.forEach((ws) => {
      this.clients.delete(ws);
    });
  }

  /**
   * Send message to specific client
   */
  sendToClient(client: ExtendedWebSocket, message: DashboardEventMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebSocket] Send to client error:', error);
        this.clients.delete(client);
      }
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected clients
   */
  getClients(): ExtendedWebSocket[] {
    return Array.from(this.clients);
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    this.clients.forEach((ws) => {
      try {
        ws.close(1000, 'Server shutting down');
      } catch (error) {
        console.error('[WebSocket] Close error:', error);
      }
    });

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[WebSocket] Server closed');
  }

  private handleConnection(ws: ExtendedWebSocket): void {
    // Add to client set
    this.clients.add(ws);

    // Assign client identity & timestamps
    try {
      ws.clientId = this.safeGenerateClientId();
    } catch {
      // Fallback simple id
      ws.clientId = `client-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    }
    ws.connectedAt = Date.now();

    // Record connection in metrics
    try {
      getMetricsCollector().recordConnection(ws.clientId);
    } catch (err) {
      console.error('[WebSocket] metrics recordConnection failed:', err);
    }

    // Broadcast connection event
    this.broadcast({
      type: 'client_connect',
      timestamp: Date.now(),
      data: { clientId: ws.clientId, timestamp: ws.connectedAt }
    });

    // Setup client event handlers
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        console.error('[WebSocket] Invalid message format:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.clients.delete(ws);
      const disconnectTs = Date.now();
      const duration = ws.connectedAt ? disconnectTs - ws.connectedAt : 0;
      const wantStructured = process.env.MCP_DEBUG === '1' || process.env.MCP_VERBOSE_LOGGING === '1';
      const structuredDisc = { ts: disconnectTs, level: 'info', src: 'websocket', event: 'client_disconnected', code, reason: reason.toString(), id: ws.clientId, durationMs: duration, totalClients: this.clients.size };
      try {
        if (wantStructured) {
          console.log(JSON.stringify(structuredDisc));
        } else {
          console.log(`[WebSocket] Client disconnected: code=${code} reason=${reason.toString()} id=${ws.clientId} duration=${duration}ms`);
        }
      } catch {/* ignore */}
      if (ws.clientId) {
        try {
          getMetricsCollector().recordDisconnection(ws.clientId);
        } catch (err) {
          console.error('[WebSocket] metrics recordDisconnection failed:', err);
        }
        this.broadcast({
          type: 'client_disconnect',
          timestamp: disconnectTs,
          data: { clientId: ws.clientId, timestamp: disconnectTs, duration }
        });
      }
      // Push fresh metrics snapshot after disconnect
      this.broadcastMetricsSnapshot();
    });

    ws.on('error', (error: Error) => {
      this.clients.delete(ws);
      const wantStructured = process.env.MCP_DEBUG === '1' || process.env.MCP_VERBOSE_LOGGING === '1';
      const structuredErr = { ts: Date.now(), level: 'error', src: 'websocket', event: 'client_error', message: error.message, stack: error.stack, id: ws.clientId };
      try {
        if (wantStructured) {
          console.log(JSON.stringify(structuredErr));
        } else {
          console.error('[WebSocket] Client error:', error);
        }
      } catch {/* ignore */}
    });

    ws.on('pong', () => {
      // Mark as alive (handled by ping/pong mechanism)
      ws.isAlive = true;
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      timestamp: Date.now(),
      data: {
        message: 'Connected to MCP Index Server Dashboard',
        version: '1.0.0',
        features: ['real-time-metrics', 'tool-monitoring', 'admin-controls'],
      },
    });

    // Dual-format logging (no new env flags): structured JSON when MCP_DEBUG or MCP_VERBOSE_LOGGING enabled, else concise plain text
    const wantStructured = process.env.MCP_DEBUG === '1' || process.env.MCP_VERBOSE_LOGGING === '1';
    const structuredConn = { ts: Date.now(), level: 'info', src: 'websocket', event: 'client_connected', totalClients: this.clients.size };
    try {
      if (wantStructured) {
        console.log(JSON.stringify(structuredConn));
      } else {
        console.log(`[WebSocket] Client connected. Total clients: ${this.clients.size}`);
      }
    } catch {/* ignore */}

  // Send immediate metrics snapshot to the new client
  this.sendCurrentMetrics(ws);
  // And broadcast updated snapshot to all clients (active connection count changed)
  this.broadcastMetricsSnapshot();
  }

  private handleClientMessage(client: ExtendedWebSocket, message: { type: string; data?: unknown }): void {
    try {
      switch (message.type) {
        case 'ping':
          this.sendToClient(client, {
            type: 'pong',
            timestamp: Date.now(),
            data: message.data,
          });
          break;

        case 'subscribe': {
          // Future: Handle subscription to specific events
          const events = (message.data as { events?: string[] })?.events || ['all'];
          this.sendToClient(client, {
            type: 'subscribed',
            timestamp: Date.now(),
            data: { events },
          });
          break;
        }

        case 'get_metrics':
          this.sendCurrentMetrics(client);
          break;

        default:
          console.warn('[WebSocket] Unknown message type:', message.type);
          this.sendError(client, `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[WebSocket] Message handling error:', error);
      this.sendError(client, 'Message handling error');
    }
  }

  private sendError(client: ExtendedWebSocket, message: string): void {
    this.sendToClient(client, {
      type: 'error',
      timestamp: Date.now(),
      data: {
        message,
        severity: 'medium' as const,
      },
    });
  }

  private startHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      this.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          // Client didn't respond to ping, terminate
          ws.terminate();
          this.clients.delete(ws);
          if (ws.clientId) {
            try { getMetricsCollector().recordDisconnection(ws.clientId); } catch (err) { console.error('[WebSocket] heartbeat disconnect metrics error:', err); }
            this.broadcast({
              type: 'client_disconnect',
              timestamp: Date.now(),
              data: { clientId: ws.clientId, timestamp: Date.now(), duration: ws.connectedAt ? Date.now() - ws.connectedAt : 0 }
            });
            this.broadcastMetricsSnapshot();
          }
          return;
        }

        // Mark as potentially dead until pong received
        ws.isAlive = false;
        
        try {
          ws.ping();
        } catch (error) {
          console.error('[WebSocket] Ping error:', error);
          this.clients.delete(ws);
        }
      });
    }, this.options.pingInterval);
  }

  /** Generate a UUID using crypto.randomUUID if available */
  private safeGenerateClientId(): string {
    if (typeof randomUUID === 'function') return randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'client-' + Math.random().toString(36).slice(2);
  }

  /** Send current metrics snapshot to a specific client */
  private sendCurrentMetrics(client: ExtendedWebSocket): void {
    try {
      const snapshot = getMetricsCollector().getCurrentSnapshot();
      this.sendToClient(client, {
        type: 'metrics_update',
        timestamp: Date.now(),
        data: snapshot,
      });
    } catch (err) {
      console.error('[WebSocket] Failed to send metrics snapshot:', err);
    }
  }

  /** Broadcast fresh metrics snapshot to all clients */
  private broadcastMetricsSnapshot(): void {
    try {
      const snapshot = getMetricsCollector().getCurrentSnapshot();
      this.broadcast({
        type: 'metrics_update',
        timestamp: Date.now(),
        data: snapshot,
      });
    } catch (err) {
      console.error('[WebSocket] Failed to broadcast metrics snapshot:', err);
    }
  }

  /**
   * Return lightweight summaries of active websocket connections with real IDs and durations.
   * Exposed via /api/admin/connections for dashboard consumption.
   */
  getActiveConnectionSummaries(): { id: string; connectedAt: number; durationMs: number }[] {
    const now = Date.now();
    return this.getClients().map(c => ({
      id: c.clientId || 'unknown',
      connectedAt: c.connectedAt || now,
      durationMs: c.connectedAt ? now - c.connectedAt : 0
    }));
  }
}

// Global singleton instance
let globalWebSocketManager: WebSocketManager | null = null;

/**
 * Get or create the global WebSocket manager instance
 */
export function getWebSocketManager(): WebSocketManager {
  if (!globalWebSocketManager) {
    globalWebSocketManager = new WebSocketManager();
  }
  return globalWebSocketManager;
}

/**
 * Set a custom WebSocket manager instance (useful for testing)
 */
export function setWebSocketManager(manager: WebSocketManager | null): void {
  globalWebSocketManager = manager;
}
