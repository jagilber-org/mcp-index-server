/**
 * WebSocketManager - Phase 1 Dashboard Foundation
 * 
 * Manages WebSocket connections for real-time dashboard updates.
 * Provides bidirectional communication between dashboard clients and server.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { MetricsSnapshot } from './MetricsCollector.js';

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

export type DashboardEventMessage = 
  | MetricsUpdateMessage
  | ToolCallMessage
  | ClientConnectMessage
  | ClientDisconnectMessage
  | ErrorMessage
  | GenericMessage;

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
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
      console.log(`[WebSocket] Client disconnected: ${code} ${reason.toString()}`);
    });

    ws.on('error', (error: Error) => {
      console.error('[WebSocket] Client error:', error);
      this.clients.delete(ws);
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

    console.log(`[WebSocket] Client connected. Total clients: ${this.clients.size}`);
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
          // Future: Send current metrics snapshot
          // This will be implemented when metrics integration is added
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
