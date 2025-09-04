/**
 * MetricsCollector - Phase 1 Dashboard Foundation
 * 
 * Collects and aggregates real-time server metrics for dashboard display.
 * Provides in-memory storage with configurable retention periods.
 */

import fs from 'fs';
import path from 'path';

export interface ToolMetrics {
  callCount: number;
  successCount: number;
  errorCount: number;
  totalResponseTime: number;
  lastCalled?: number;
  errorTypes: { [errorType: string]: number };
}

export interface ServerMetrics {
  uptime: number;
  version: string;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  startTime: number;
}

export interface ConnectionMetrics {
  activeConnections: number;
  totalConnections: number;
  disconnectedConnections: number;
  avgSessionDuration: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  server: ServerMetrics;
  tools: { [toolName: string]: ToolMetrics };
  connections: ConnectionMetrics;
  performance: {
    requestsPerMinute: number;
    successRate: number;
    avgResponseTime: number;
    errorRate: number;
  };
}

export interface MetricsCollectorOptions {
  retentionMinutes?: number;
  maxSnapshots?: number;
  collectInterval?: number;
}

export class MetricsCollector {
  private tools: Map<string, ToolMetrics> = new Map();
  private snapshots: MetricsSnapshot[] = [];
  private connections: Set<string> = new Set();
  private disconnectedCount = 0;
  private totalSessionTime = 0;
  private sessionStartTimes: Map<string, number> = new Map();
  private startTime = Date.now();
  private options: Required<MetricsCollectorOptions>;
  private collectTimer?: NodeJS.Timeout;
  private lastCpuUsage?: NodeJS.CpuUsage;

  constructor(options: MetricsCollectorOptions = {}) {
    this.options = {
      retentionMinutes: options.retentionMinutes ?? 60,
      maxSnapshots: options.maxSnapshots ?? 720, // 12 hours at 1-minute intervals
      collectInterval: options.collectInterval ?? 60000, // 1 minute
    };

    // Start periodic collection
    this.startCollection();
  }

  /**
   * Record a tool call event
   */
  recordToolCall(toolName: string, success: boolean, responseTimeMs: number, errorType?: string): void {
    if (!this.tools.has(toolName)) {
      this.tools.set(toolName, {
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        totalResponseTime: 0,
        errorTypes: {},
      });
    }

    const metrics = this.tools.get(toolName)!;
    metrics.callCount++;
    metrics.totalResponseTime += responseTimeMs;
    metrics.lastCalled = Date.now();

    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
      if (errorType) {
        metrics.errorTypes[errorType] = (metrics.errorTypes[errorType] || 0) + 1;
      }
    }
  }

  /**
   * Record client connection
   */
  recordConnection(clientId: string): void {
    this.connections.add(clientId);
    this.sessionStartTimes.set(clientId, Date.now());
  }

  /**
   * Record client disconnection
   */
  recordDisconnection(clientId: string): void {
    if (this.connections.has(clientId)) {
      this.connections.delete(clientId);
      this.disconnectedCount++;

      const sessionStart = this.sessionStartTimes.get(clientId);
      if (sessionStart) {
        this.totalSessionTime += Date.now() - sessionStart;
        this.sessionStartTimes.delete(clientId);
      }
    }
  }

  /**
   * Get current metrics snapshot
   */
  getCurrentSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const uptime = now - this.startTime;

    // Calculate performance metrics
    const totalCalls = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.callCount, 0);
    const totalSuccesses = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.successCount, 0);
    const totalErrors = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.errorCount, 0);
    const totalResponseTime = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.totalResponseTime, 0);

    const requestsPerMinute = totalCalls > 0 ? (totalCalls / (uptime / 60000)) : 0;
    const successRate = totalCalls > 0 ? (totalSuccesses / totalCalls) * 100 : 100;
    const avgResponseTime = totalCalls > 0 ? (totalResponseTime / totalCalls) : 0;
    const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;

    // Calculate average session duration
    const activeSessionTime = Array.from(this.sessionStartTimes.values())
      .reduce((sum, startTime) => sum + (now - startTime), 0);
    const totalSessions = this.disconnectedCount + this.connections.size;
    const avgSessionDuration = totalSessions > 0 
      ? (this.totalSessionTime + activeSessionTime) / totalSessions 
      : 0;

    // Get CPU usage (if available)
    let cpuUsage: NodeJS.CpuUsage | undefined;
    try {
      cpuUsage = process.cpuUsage(this.lastCpuUsage);
      this.lastCpuUsage = process.cpuUsage();
    } catch {
      // CPU usage not available on all platforms
    }

    return {
      timestamp: now,
      server: {
        uptime,
        version: this.getVersion(),
        memoryUsage: process.memoryUsage(),
        cpuUsage,
        startTime: this.startTime,
      },
      tools: Object.fromEntries(this.tools.entries()),
      connections: {
        activeConnections: this.connections.size,
        totalConnections: this.disconnectedCount + this.connections.size,
        disconnectedConnections: this.disconnectedCount,
        avgSessionDuration,
      },
      performance: {
        requestsPerMinute,
        successRate,
        avgResponseTime,
        errorRate,
      },
    };
  }

  /**
   * Get historical snapshots
   */
  getSnapshots(count?: number): MetricsSnapshot[] {
    if (count) {
      return this.snapshots.slice(-count);
    }
    return [...this.snapshots];
  }

  /**
   * Get tool-specific metrics
   */
  getToolMetrics(toolName?: string): { [toolName: string]: ToolMetrics } | ToolMetrics | null {
    if (toolName) {
      return this.tools.get(toolName) || null;
    }
    return Object.fromEntries(this.tools.entries());
  }

  /**
   * Clear all metrics data
   */
  clearMetrics(): void {
    this.tools.clear();
    this.snapshots.length = 0;
    this.connections.clear();
    this.disconnectedCount = 0;
    this.totalSessionTime = 0;
    this.sessionStartTimes.clear();
    this.startTime = Date.now();
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = undefined;
    }
  }

  private startCollection(): void {
    // Take initial snapshot
    this.takeSnapshot();

    // Schedule periodic snapshots
    this.collectTimer = setInterval(() => {
      this.takeSnapshot();
    }, this.options.collectInterval);
  }

  private takeSnapshot(): void {
    const snapshot = this.getCurrentSnapshot();
    this.snapshots.push(snapshot);

    // Trim old snapshots
    if (this.snapshots.length > this.options.maxSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.options.maxSnapshots);
    }

    // Remove snapshots older than retention period
    const cutoff = Date.now() - (this.options.retentionMinutes * 60 * 1000);
    const firstValidIndex = this.snapshots.findIndex(s => s.timestamp >= cutoff);
    if (firstValidIndex > 0) {
      this.snapshots.splice(0, firstValidIndex);
    }
  }

  private getVersion(): string {
    try {
      const candidates = [
        path.join(process.cwd(), 'package.json'),
        path.join(__dirname, '..', '..', '..', 'package.json')
      ];
      
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (pkg?.version) return pkg.version;
        }
      }
    } catch {
      // Ignore errors
    }
    return '0.0.0';
  }
}

// Global singleton instance
let globalCollector: MetricsCollector | null = null;

/**
 * Get or create the global metrics collector instance
 */
export function getMetricsCollector(): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector();
  }
  return globalCollector;
}

/**
 * Set a custom metrics collector instance (useful for testing)
 */
export function setMetricsCollector(collector: MetricsCollector | null): void {
  globalCollector = collector;
}
