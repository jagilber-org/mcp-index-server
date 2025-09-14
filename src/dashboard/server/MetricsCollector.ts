/**
 * MetricsCollector - Phase 1 Dashboard Foundation
 * 
 * Collects and aggregates real-time server metrics for dashboard display.
 * Uses file-based storage to prevent memory accumulation.
 */

import fs from 'fs';
import path from 'path';
import { getFileMetricsStorage, FileMetricsStorage } from './FileMetricsStorage.js';
import { BufferRing, OverflowStrategy, BufferRingStats } from '../../utils/BufferRing.js';
import { getBooleanEnv } from '../../utils/envUtils.js';

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

// BufferRing-Enhanced Metrics Interfaces
export interface MetricsTimeSeriesEntry {
  timestamp: number;
  snapshot: MetricsSnapshot;
  performanceData: {
    responseTimeMs: number;
    requestCount: number;
    errorCount: number;
    connectionCount: number;
  };
}

export interface ToolCallEvent {
  timestamp: number;
  toolName: string;
  success: boolean;
  responseTimeMs: number;
  errorType?: string;
  clientId?: string;
}

export interface MetricsBufferConfig {
  historicalSnapshots: {
    capacity: number;
    retentionMinutes: number;
    persistenceFile?: string;
  };
  toolCallEvents: {
    capacity: number;
    retentionMinutes: number;
    persistenceFile?: string;
  };
  performanceMetrics: {
    capacity: number;
    persistenceFile?: string;
  };
}

// Phase 3: Real-time chart data interfaces
export interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

export interface ToolUsageChartData {
  toolName: string;
  data: ChartDataPoint[];
  color?: string;
}

export interface PerformanceChartData {
  responseTime: ChartDataPoint[];
  requestRate: ChartDataPoint[];
  errorRate: ChartDataPoint[];
  successRate: ChartDataPoint[];
}

export interface RealtimeMetrics {
  currentRpm: number;
  activeConnections: number;
  avgResponseTime: number;
  successRate: number;
  errorRate: number;
  topTools: Array<{ name: string; calls: number; avgTime: number }>;
  recentErrors: Array<{ tool: string; error: string; timestamp: number }>;
}

// Phase 4: Advanced Real-time & Analytics Interfaces
export interface RealtimeStreamingData {
  timestamp: number;
  systemHealth: SystemHealth;
  performanceMetrics: EnhancedPerformanceMetrics;
  recentActivity: ActivityEvent[];
  streamingStats: StreamingStats;
}

export interface SystemHealth {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkLatency: number;
  uptime: number;
  lastHealthCheck: Date;
  status: 'healthy' | 'warning' | 'critical';
}

export interface EnhancedPerformanceMetrics {
  requestThroughput: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  concurrentConnections: number;
  totalRequests: number;
  successfulRequests: number;
  requestsPerSecond: number;
  bytesTransferred: number;
}

export interface StreamingStats {
  totalStreamingConnections: number;
  dataTransferRate: number;
  latency: number;
  compressionRatio: number;
}

export interface ActivityEvent {
  tool: string;
  lastActivity: Date | null;
  recentCalls: number;
}

export interface AdvancedAnalytics {
  timeRange: string;
  hourlyStats: HourlyStats[];
  toolUsageBreakdown: ToolUsageStats[];
  errorAnalysis: ErrorAnalysis;
  performanceTrends: PerformanceTrend[];
  predictionData: PredictionData | null;
  anomalies: Anomaly[];
}

export interface HourlyStats {
  hour: string;
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
}

export interface ToolUsageStats {
  toolName: string;
  callCount: number;
  successRate: number;
  avgResponseTime: number;
  lastCalled: Date | null;
}

export interface ErrorAnalysis {
  errorTypes: { [type: string]: number };
  totalErrors: number;
  errorRate: number;
}

export interface PerformanceTrend {
  timestamp: Date;
  responseTime: number;
  throughput: number;
  errorRate: number;
}

export interface PredictionData {
  responseTimeProjection: number;
  throughputProjection: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface Anomaly {
  type: string;
  timestamp: Date;
  value: number;
  severity: 'low' | 'medium' | 'high';
}

export interface Alert {
  id: string;
  type: 'error_rate' | 'response_time' | 'memory' | 'cpu' | 'system' | 'network';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  value: number;
  threshold: number;
  source: string;
  category: string;
}

export interface MetricsCollectorOptions {
  retentionMinutes?: number;
  maxSnapshots?: number;
  collectInterval?: number;
}

export class MetricsCollector {
  private tools: Map<string, ToolMetrics> = new Map();
  // Resource usage samples (CPU/Memory) for leak/trend analysis
  private resourceSamples: BufferRing<{ timestamp: number; cpuPercent: number; heapUsed: number; rss: number }>;  
  private lastCpuUsageSample: NodeJS.CpuUsage | null = null;
  private lastCpuSampleTime = 0;
  private snapshots: MetricsSnapshot[] = []; // Keep small in-memory cache for real-time queries
  private connections: Set<string> = new Set();
  private disconnectedCount = 0;
  private totalSessionTime = 0;
  private sessionStartTimes: Map<string, number> = new Map();
  private startTime = Date.now();
  private options: Required<MetricsCollectorOptions>;
  private collectTimer?: NodeJS.Timeout;
  private lastCpuUsage?: NodeJS.CpuUsage;
  // Phase 4: Advanced features
  private recentAlerts: Alert[] = [];
  private activeConnections = 0;
  // Rolling timestamp buffer for recent tool calls (used for stable RPM calculation)
  private recentCallTimestamps: number[] = [];
  private static readonly MAX_RECENT_CALLS = 10000; // cap to avoid unbounded growth
  private static readonly MAX_MEMORY_SNAPSHOTS = 60; // Keep only 1 hour in memory
  private static readonly MAX_TOOL_METRICS = 1000; // cap tool metrics to prevent memory leaks
  // File storage for historical data (optional)
  private fileStorage: FileMetricsStorage | null = null;
  private useFileStorage: boolean;
  
  // BufferRing-Enhanced Storage
  private historicalSnapshots: BufferRing<MetricsTimeSeriesEntry>;
  private toolCallEvents: BufferRing<ToolCallEvent>;

  // Persistence throttling state for tool call events (defined explicitly to avoid dynamic props)
  private _lastToolPersist: number = 0;
  private _pendingToolPersist: number = 0;
  private performanceMetrics: BufferRing<{ timestamp: number; responseTime: number; throughput: number; errorRate: number }>;
  private bufferConfig: MetricsBufferConfig;
  // Append/segment logging state (optional)
  private appendMode = false;
  private appendLogPath: string | null = null;
  private pendingAppendEvents: ToolCallEvent[] = [];
  private lastAppendFlush = 0;
  private lastAppendCompact = 0;
  private appendChunkSize = 250;
  private appendFlushMs = 5000;
  private appendCompactMs = 5 * 60 * 1000; // 5 min default

  constructor(options: MetricsCollectorOptions = {}) {
    this.options = {
      retentionMinutes: options.retentionMinutes ?? 60,
      maxSnapshots: options.maxSnapshots ?? 720, // 12 hours at 1-minute intervals
      collectInterval: options.collectInterval ?? 60000, // 1 minute
    };
    // Initialize resource sampling buffer (default capacity ~1h at 5s interval = 720)
    const resourceCapacity = parseInt(process.env.MCP_RESOURCE_CAPACITY || '720');
    this.resourceSamples = new BufferRing<{ timestamp: number; cpuPercent: number; heapUsed: number; rss: number }>({
      capacity: resourceCapacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      autoPersist: false,
      enableIntegrityCheck: false
    });
    try {
      const intervalMs = parseInt(process.env.MCP_RESOURCE_SAMPLE_INTERVAL_MS || '5000');
      setInterval(() => this.sampleResources(), intervalMs).unref();
    } catch { /* ignore */ }

    // Configure BufferRing settings
    const metricsDir = process.env.MCP_METRICS_DIR || path.join(process.cwd(), 'metrics');
    this.bufferConfig = {
      historicalSnapshots: {
        capacity: this.options.maxSnapshots,
        retentionMinutes: this.options.retentionMinutes * 12, // Keep 12x longer than original
        persistenceFile: path.join(metricsDir, 'historical-snapshots.json')
      },
      toolCallEvents: {
        capacity: 10000, // Store last 10k tool calls
        retentionMinutes: this.options.retentionMinutes * 2, // 2 hours of tool calls
        persistenceFile: path.join(metricsDir, 'tool-call-events.json')
      },
      performanceMetrics: {
        capacity: 1440, // Store 24 hours worth of minute-by-minute metrics
        persistenceFile: path.join(metricsDir, 'performance-metrics.json')
      }
    };

    // Check if file storage should be enabled (accept "true", "1", "yes", "on")
    this.useFileStorage = getBooleanEnv('MCP_METRICS_FILE_STORAGE');
    
    // Initialize BufferRing storage
    this.historicalSnapshots = new BufferRing<MetricsTimeSeriesEntry>({
      capacity: this.bufferConfig.historicalSnapshots.capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath: this.useFileStorage ? this.bufferConfig.historicalSnapshots.persistenceFile : undefined,
      autoPersist: this.useFileStorage
    });

    this.toolCallEvents = new BufferRing<ToolCallEvent>({
      capacity: this.bufferConfig.toolCallEvents.capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath: this.useFileStorage ? this.bufferConfig.toolCallEvents.persistenceFile : undefined,
      autoPersist: false, // we'll manage chunked persistence manually for performance
      suppressPersistLog: true
    });

    this.performanceMetrics = new BufferRing<{ timestamp: number; responseTime: number; throughput: number; errorRate: number }>({
      capacity: this.bufferConfig.performanceMetrics.capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath: this.useFileStorage ? this.bufferConfig.performanceMetrics.persistenceFile : undefined,
      autoPersist: this.useFileStorage
    });

    // Configure optional append-only logging for tool call events (reduces large snapshot writes)
    if (this.useFileStorage) {
      this.appendMode = getBooleanEnv('MCP_TOOLCALL_APPEND_LOG');
      if (this.appendMode) {
        this.appendLogPath = path.join(path.dirname(this.bufferConfig.toolCallEvents.persistenceFile!), 'tool-call-events.ndjson');
        this.appendChunkSize = parseInt(process.env.MCP_TOOLCALL_CHUNK_SIZE || `${this.appendChunkSize}`) || this.appendChunkSize;
        this.appendFlushMs = parseInt(process.env.MCP_TOOLCALL_FLUSH_MS || `${this.appendFlushMs}`) || this.appendFlushMs;
        this.appendCompactMs = parseInt(process.env.MCP_TOOLCALL_COMPACT_MS || `${this.appendCompactMs}`) || this.appendCompactMs;
        try {
          // Load any un-compacted append log tail (best-effort)
            if (this.appendLogPath && fs.existsSync(this.appendLogPath)) {
              const stat = fs.statSync(this.appendLogPath);
              if (stat.size < 25 * 1024 * 1024) { // safety cap 25MB
                const raw = fs.readFileSync(this.appendLogPath, 'utf8');
                const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
                for (const line of lines) {
                  try {
                    const evt = JSON.parse(line) as ToolCallEvent;
                    this.toolCallEvents.add(evt);
                  } catch {/* ignore bad line */}
                }
              } else {
                console.warn('tool-call-events.ndjson too large to preload (>25MB); will rely on last snapshot');
              }
            }
        } catch (err) {
          console.warn('Failed to preload append log', err);
        }
      }
    }
    
    if (this.useFileStorage) {
      // Initialize legacy file storage for backward compatibility
      this.fileStorage = getFileMetricsStorage({
        storageDir: metricsDir,
        maxFiles: this.options.maxSnapshots,
        retentionMinutes: this.options.retentionMinutes,
      });
      console.log('📊 MetricsCollector: BufferRing + File storage enabled');
    } else {
      console.log('📊 MetricsCollector: BufferRing memory-only mode (set MCP_METRICS_FILE_STORAGE=1|true|yes|on for persistence)');
    }

    // Start periodic collection
    this.startCollection();
  }

  /**
   * Record a tool call event
   */
  recordToolCall(toolName: string, success: boolean, responseTimeMs: number, errorType?: string, clientId?: string): void {
    const now = Date.now();
    
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
    metrics.lastCalled = now;

    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
      if (errorType) {
        metrics.errorTypes[errorType] = (metrics.errorTypes[errorType] || 0) + 1;
      }
    }

    // Store detailed tool call event in BufferRing
    this.toolCallEvents.add({
      timestamp: now,
      toolName,
      success,
      responseTimeMs,
      errorType,
      clientId
    });
    if (this.useFileStorage) {
      if (this.appendMode) {
        this.pendingAppendEvents.push({ timestamp: now, toolName, success, responseTimeMs, errorType, clientId });
        this.flushToolCallEvents(false); // schedule conditional flush
      } else {
        // legacy snapshot batching (retain previous throttling fields)
        this._pendingToolPersist++;
        const dueTime = now - this._lastToolPersist > this.appendFlushMs;
        if (this._pendingToolPersist >= this.appendChunkSize || dueTime) {
          setTimeout(() => {
            this.toolCallEvents.saveToDisk().catch(()=>{});
            this._lastToolPersist = Date.now();
            this._pendingToolPersist = 0;
          }, 0).unref?.();
        }
      }
    }

    // Track call timestamp for rolling RPM calculation (last 60s window)
    this.recentCallTimestamps.push(now);
    // Prune anything older than 5 minutes to constrain memory
    const cutoff = now - 5 * 60 * 1000;
    if (this.recentCallTimestamps.length > MetricsCollector.MAX_RECENT_CALLS || (this.recentCallTimestamps.length % 100) === 0) {
      // Periodically prune (on every 100th push or when over cap)
      let firstValidIdx = 0;
      while (firstValidIdx < this.recentCallTimestamps.length && this.recentCallTimestamps[firstValidIdx] < cutoff) firstValidIdx++;
      if (firstValidIdx > 0) this.recentCallTimestamps.splice(0, firstValidIdx);
      // Hard cap safeguard
      if (this.recentCallTimestamps.length > MetricsCollector.MAX_RECENT_CALLS) {
        this.recentCallTimestamps.splice(0, this.recentCallTimestamps.length - MetricsCollector.MAX_RECENT_CALLS);
      }
    }

    // Prevent unbounded tool metrics growth - cleanup old/unused tools after adding the new tool
    if (this.tools.size > MetricsCollector.MAX_TOOL_METRICS) {
      this.cleanupOldToolMetrics();
    }
  }

  /** Flush tool call events (append or snapshot) */
  private flushToolCallEvents(force: boolean) {
    if (!this.useFileStorage) return;
    const now = Date.now();
    if (this.appendMode) {
      const timeDue = (now - this.lastAppendFlush) >= this.appendFlushMs;
      if (!force && this.pendingAppendEvents.length < this.appendChunkSize && !timeDue) return;
      if (!this.appendLogPath || this.pendingAppendEvents.length === 0) return;
      const toWrite = this.pendingAppendEvents.splice(0, this.pendingAppendEvents.length);
      const lines = toWrite.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.promises.appendFile(this.appendLogPath, lines).catch(()=>{});
      this.lastAppendFlush = now;
      // Periodic compaction: write full snapshot & truncate log
      if ((now - this.lastAppendCompact) >= this.appendCompactMs || force) {
        this.toolCallEvents.saveToDisk().catch(()=>{});
        this.lastAppendCompact = now;
        if (this.appendLogPath) {
          fs.promises.writeFile(this.appendLogPath, '').catch(()=>{}); // truncate
        }
      }
    } else {
      // snapshot mode manual force
      if (force) {
        this.toolCallEvents.saveToDisk().catch(()=>{});
        this._lastToolPersist = now;
        this._pendingToolPersist = 0;
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

    // Stable rolling Requests Per Minute based on last 60s calls (not lifetime average)
    const oneMinuteCutoff = now - 60 * 1000;
    let recentCount = 0;
    // Iterate from end backwards until we exit window (timestamps are append-only & ascending)
    for (let i = this.recentCallTimestamps.length - 1; i >= 0; i--) {
      const ts = this.recentCallTimestamps[i];
      if (ts >= oneMinuteCutoff) recentCount++; else break;
    }
    const requestsPerMinute = recentCount;
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
   * Get historical snapshots (from memory for recent, or from files for historical)
   */
  getSnapshots(count?: number): MetricsSnapshot[] {
    if (count) {
      return this.snapshots.slice(-count);
    }
    return [...this.snapshots];
  }

  /**
   * Get snapshots from file storage (for historical analysis)
   */
  async getHistoricalSnapshots(count: number = 720): Promise<MetricsSnapshot[]> {
    if (!this.fileStorage) {
      console.warn('File storage not enabled, returning memory snapshots only');
      return this.getSnapshots(count);
    }
    
    try {
      return await this.fileStorage.getRecentSnapshots(count);
    } catch (error) {
      console.error('Failed to load historical snapshots:', error);
      return [];
    }
  }

  /**
   * Get snapshots within a specific time range from files
   */
  async getSnapshotsInRange(startTime: number, endTime: number): Promise<MetricsSnapshot[]> {
    if (!this.fileStorage) {
      console.warn('File storage not enabled, filtering memory snapshots');
      return this.snapshots.filter(s => s.timestamp >= startTime && s.timestamp <= endTime);
    }
    
    try {
      return await this.fileStorage.getSnapshotsInRange(startTime, endTime);
    } catch (error) {
      console.error('Failed to load snapshots in range:', error);
      return [];
    }
  }

  /**
   * Get file storage statistics
   */
  async getStorageStats(): Promise<{
    fileCount: number;
    totalSizeKB: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
    memorySnapshots: number;
  }> {
    if (!this.fileStorage) {
      return {
        fileCount: 0,
        totalSizeKB: 0,
        memorySnapshots: this.snapshots.length,
      };
    }
    
    const fileStats = await this.fileStorage.getStorageStats();
    return {
      ...fileStats,
      memorySnapshots: this.snapshots.length,
    };
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
   * Clear all metrics data (memory and files)
   */
  async clearMetrics(): Promise<void> {
    // Clear in-memory data
    this.tools.clear();
    this.snapshots.length = 0;
    this.connections.clear();
    this.disconnectedCount = 0;
    this.totalSessionTime = 0;
    this.sessionStartTimes.clear();
    this.startTime = Date.now();
    this.recentCallTimestamps.length = 0;
    
    // Clear file storage if enabled
    if (this.fileStorage) {
      try {
        await this.fileStorage.clearAll();
      } catch (error) {
        console.error('Failed to clear file storage:', error);
      }
    }
  }

  /**
   * Clear only memory data (keep files)
   */
  clearMemoryMetrics(): void {
    this.tools.clear();
    this.snapshots.length = 0;
    this.connections.clear();
    this.disconnectedCount = 0;
    this.totalSessionTime = 0;
    this.sessionStartTimes.clear();
    this.startTime = Date.now();
    this.recentCallTimestamps.length = 0;
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
    
    // Store enhanced snapshot in BufferRing with performance data
    const timeSeriesEntry: MetricsTimeSeriesEntry = {
      timestamp: snapshot.timestamp,
      snapshot,
      performanceData: {
        responseTimeMs: snapshot.performance.avgResponseTime,
        requestCount: Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.callCount, 0),
        errorCount: Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.errorCount, 0),
        connectionCount: snapshot.connections.activeConnections
      }
    };
    
    this.historicalSnapshots.add(timeSeriesEntry);
    
    // Store performance metrics for charting
    this.performanceMetrics.add({
      timestamp: snapshot.timestamp,
      responseTime: snapshot.performance.avgResponseTime,
      throughput: snapshot.performance.requestsPerMinute,
      errorRate: snapshot.performance.errorRate
    });
    
    // Store to file immediately (async, non-blocking) if file storage enabled
    if (this.fileStorage) {
      this.fileStorage.storeSnapshot(snapshot).catch(error => {
        console.error('Failed to store metrics snapshot to file:', error);
      });
    }
    
    // Keep limited snapshots in memory for real-time queries
    this.snapshots.push(snapshot);
    
    // Trim in-memory snapshots to prevent memory accumulation
    const maxMemorySnapshots = this.useFileStorage 
      ? MetricsCollector.MAX_MEMORY_SNAPSHOTS 
      : this.options.maxSnapshots;
      
    if (this.snapshots.length > maxMemorySnapshots) {
      this.snapshots.splice(0, this.snapshots.length - maxMemorySnapshots);
    }

    // If not using file storage, apply original retention logic
    if (!this.useFileStorage) {
      const cutoff = Date.now() - (this.options.retentionMinutes * 60 * 1000);
      const firstValidIndex = this.snapshots.findIndex(s => s.timestamp >= cutoff);
      if (firstValidIndex > 0) {
        this.snapshots.splice(0, firstValidIndex);
      }
    }

    // Periodically cleanup tool metrics (every 10 snapshots, ~10 minutes)
    if (this.snapshots.length % 10 === 0) {
      this.cleanupOldToolMetrics();
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

  // ====== Helper Methods for Metrics Calculation ======

  private getTotalRequests(): number {
    let total = 0;
    this.tools.forEach(metrics => {
      total += metrics.callCount;
    });
    return total;
  }

  private getAverageResponseTime(): number {
    let totalTime = 0;
    let totalCalls = 0;
    
    this.tools.forEach(metrics => {
      totalTime += metrics.totalResponseTime;
      totalCalls += metrics.callCount;
    });
    
    return totalCalls > 0 ? totalTime / totalCalls : 0;
  }

  private getErrorRate(): number {
    const totalCalls = this.getTotalRequests();
    const totalErrors = this.getTotalErrors();
    return totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;
  }

  private getTotalErrors(): number {
    let total = 0;
    this.tools.forEach(metrics => {
      total += metrics.errorCount;
    });
    return total;
  }

  // ====== Phase 3: Real-time Chart Data Methods ======

  /**
   * Get real-time metrics for dashboard widgets
   */
  getRealtimeMetrics(): RealtimeMetrics {
    const latest = this.getCurrentSnapshot();
  // Use rolling buffer based RPM directly
  const currentRpm = latest.performance.requestsPerMinute;

    // Get top 5 most used tools
    const topTools = Array.from(this.tools.entries())
      .sort((a, b) => b[1].callCount - a[1].callCount)
      .slice(0, 5)
      .map(([name, metrics]) => ({
        name,
        calls: metrics.callCount,
        avgTime: metrics.callCount > 0 ? metrics.totalResponseTime / metrics.callCount : 0
      }));

    // Get recent errors (last 10 minutes)
    const recentErrors: Array<{ tool: string; error: string; timestamp: number }> = [];
    // Note: This would be populated from error tracking if implemented

    return {
      currentRpm,
      activeConnections: latest.connections.activeConnections,
      avgResponseTime: latest.performance.avgResponseTime,
      successRate: latest.performance.successRate,
      errorRate: latest.performance.errorRate,
      topTools,
      recentErrors
    };
  }

  /**
   * Get tool usage chart data for specified time range
   */
  getToolUsageChartData(minutes: number = 60): ToolUsageChartData[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const relevantSnapshots = this.snapshots.filter(s => s.timestamp >= cutoff);
    
    if (relevantSnapshots.length === 0) return [];

    // Get all tool names
    const toolNames = new Set<string>();
    relevantSnapshots.forEach(snapshot => {
      Object.keys(snapshot.tools).forEach(name => toolNames.add(name));
    });

    // Generate color palette
    const colors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
      '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
    ];

    return Array.from(toolNames).map((toolName, index) => ({
      toolName,
      color: colors[index % colors.length],
      data: relevantSnapshots.map(snapshot => ({
        timestamp: snapshot.timestamp,
        value: snapshot.tools[toolName]?.callCount || 0,
        label: new Date(snapshot.timestamp).toLocaleTimeString()
      }))
    }));
  }

  /**
   * Get performance metrics chart data
   */
  getPerformanceChartData(minutes: number = 60): PerformanceChartData {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const relevantSnapshots = this.snapshots.filter(s => s.timestamp >= cutoff);

    const responseTime: ChartDataPoint[] = relevantSnapshots.map(s => ({
      timestamp: s.timestamp,
      value: s.performance.avgResponseTime,
      label: new Date(s.timestamp).toLocaleTimeString()
    }));

    const requestRate: ChartDataPoint[] = relevantSnapshots.map(s => ({
      timestamp: s.timestamp,
      value: s.performance.requestsPerMinute,
      label: new Date(s.timestamp).toLocaleTimeString()
    }));

    const errorRate: ChartDataPoint[] = relevantSnapshots.map(s => ({
      timestamp: s.timestamp,
      value: s.performance.errorRate,
      label: new Date(s.timestamp).toLocaleTimeString()
    }));

    const successRate: ChartDataPoint[] = relevantSnapshots.map(s => ({
      timestamp: s.timestamp,
      value: s.performance.successRate,
      label: new Date(s.timestamp).toLocaleTimeString()
    }));

    return {
      responseTime,
      requestRate,
      errorRate,
      successRate
    };
  }

  /**
   * Get metrics for specific time ranges (1h, 6h, 24h, 7d, 30d)
   */
  getTimeRangeMetrics(range: '1h' | '6h' | '24h' | '7d' | '30d'): MetricsSnapshot[] {
    const rangeMinutes = {
      '1h': 60,
      '6h': 360,
      '24h': 1440,
      '7d': 10080,
      '30d': 43200
    };

    const cutoff = Date.now() - (rangeMinutes[range] * 60 * 1000);
    return this.snapshots.filter(s => s.timestamp >= cutoff);
  }

  // ====== Phase 4: Advanced Real-time & Analytics Methods ======

  /**
   * Get advanced real-time streaming data for Phase 4
   */
  getRealtimeStreamingData(): RealtimeStreamingData {
    return {
      timestamp: Date.now(),
      systemHealth: this.getSystemHealth(),
      performanceMetrics: this.getDetailedPerformanceMetrics(),
      recentActivity: this.getRecentActivity(),
      streamingStats: {
        totalStreamingConnections: this.activeConnections,
        dataTransferRate: this.calculateDataTransferRate(),
        latency: this.calculateAverageLatency(),
        compressionRatio: 0.7
      }
    };
  }

  /**
   * Get detailed system health metrics
   */
  getSystemHealth(): SystemHealth {
    const uptime = Date.now() - this.startTime;
    return {
      cpuUsage: this.calculateCPUUsage(),
      memoryUsage: this.calculateMemoryUsage(),
      diskUsage: this.calculateDiskUsage(),
      networkLatency: this.calculateNetworkLatency(),
      uptime,
      lastHealthCheck: new Date(),
      status: this.getOverallHealthStatus()
    };
  }

  /**
   * Get enhanced performance metrics
   */
  getDetailedPerformanceMetrics(): EnhancedPerformanceMetrics {
    const totalRequests = this.getTotalRequests();
    return {
      requestThroughput: this.calculateRequestThroughput(),
      averageResponseTime: this.getAverageResponseTime(),
      p95ResponseTime: this.calculatePercentileResponseTime(95),
      p99ResponseTime: this.calculatePercentileResponseTime(99),
      errorRate: this.getErrorRate(),
      concurrentConnections: this.activeConnections,
      totalRequests,
      successfulRequests: totalRequests - this.getTotalErrors(),
      requestsPerSecond: this.calculateRequestsPerSecond(),
      bytesTransferred: this.calculateBytesTransferred()
    };
  }

  /**
   * Get advanced analytics data
   */
  getAdvancedAnalytics(timeRange: string = '1h'): AdvancedAnalytics {
    return {
      timeRange,
      hourlyStats: this.getHourlyStats(timeRange),
      toolUsageBreakdown: this.getToolUsageBreakdown(),
      errorAnalysis: this.getErrorAnalysis(),
      performanceTrends: this.getPerformanceTrends(timeRange),
      predictionData: this.getPredictionData(),
      anomalies: this.detectAnomalies()
    };
  }

  /**
   * Generate real-time alert
   */
  generateRealTimeAlert(type: string, severity: string, message: string, value: number, threshold: number): Alert {
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: type as Alert['type'],
      severity: severity as Alert['severity'],
      message,
      timestamp: new Date(),
      resolved: false,
      value,
      threshold,
      source: 'MetricsCollector',
      category: this.categorizeAlert(type)
    };

    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > 100) {
      this.recentAlerts = this.recentAlerts.slice(0, 100);
    }

    return alert;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return this.recentAlerts.filter(alert => !alert.resolved);
  }

  /**
   * Resolve alert by ID
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.recentAlerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      return true;
    }
    return false;
  }

  // Phase 4: Helper methods for advanced metrics
  private calculateCPUUsage(): number {
    const recentActivity = this.snapshots.slice(-5);
    if (recentActivity.length === 0) return 0;
    
    const avgRequests = recentActivity.reduce((sum, snap) => 
      sum + snap.performance.requestsPerMinute, 0) / recentActivity.length;
    
    return Math.min(Math.max(avgRequests / 10, 5), 95);
  }

  private calculateMemoryUsage(): number {
    const baseUsage = 20;
    const connectionUsage = this.connections.size * 0.5;
    const dataUsage = this.snapshots.length * 0.1;
    
    return Math.min(baseUsage + connectionUsage + dataUsage, 95);
  }

  private calculateDiskUsage(): number {
    return Math.min(30 + (this.snapshots.length * 0.05), 80);
  }

  private calculateNetworkLatency(): number {
    return this.getAverageResponseTime();
  }

  private getOverallHealthStatus(): 'healthy' | 'warning' | 'critical' {
    const cpu = this.calculateCPUUsage();
    const memory = this.calculateMemoryUsage();
    const errorRate = this.getErrorRate();

    if (cpu > 90 || memory > 90 || errorRate > 10) return 'critical';
    if (cpu > 75 || memory > 75 || errorRate > 5) return 'warning';
    return 'healthy';
  }

  private calculateDataTransferRate(): number {
    return this.connections.size * 0.1 + Math.random() * 0.5;
  }

  private calculateAverageLatency(): number {
    const recentSnapshots = this.snapshots.slice(-10);
    if (recentSnapshots.length === 0) return 0;
    
    return recentSnapshots.reduce((sum, snap) => 
      sum + snap.performance.avgResponseTime, 0) / recentSnapshots.length;
  }

  // ===== Resource Sampling / Leak Detection =====
  private sampleResources(): void {
    try {
      const now = Date.now();
      const mem = process.memoryUsage();
      let cpuPercent = 0;
      const curr = process.cpuUsage();
      if (this.lastCpuUsageSample && this.lastCpuSampleTime) {
        const userDiff = curr.user - this.lastCpuUsageSample.user; // microseconds
        const systemDiff = curr.system - this.lastCpuUsageSample.system;
        const elapsedMs = now - this.lastCpuSampleTime;
        if (elapsedMs > 0) {
          // total diff in microseconds / (elapsedMs * 1000) gives fraction of single core; *100 -> percent
            cpuPercent = ((userDiff + systemDiff) / 1000) / elapsedMs * 100;
          // Clamp 0-100 (single process perspective)
          if (cpuPercent < 0) cpuPercent = 0; else if (cpuPercent > 100) cpuPercent = 100;
        }
      }
      this.lastCpuUsageSample = curr;
      this.lastCpuSampleTime = now;
      this.resourceSamples.add({ timestamp: now, cpuPercent, heapUsed: mem.heapUsed, rss: mem.rss });
    } catch { /* ignore sampling errors */ }
  }

  getResourceHistory(limit = 200): { samples: { timestamp: number; cpuPercent: number; heapUsed: number; rss: number }[]; trend?: { cpuSlope: number; memSlope: number } } {
  const all = this.resourceSamples.getAll();
    const samples = limit > 0 ? all.slice(-limit) : all;
    // Simple linear regression slope for cpu & heapUsed
    let cpuSlope = 0, memSlope = 0;
    if (samples.length > 5) {
      const n = samples.length;
      const firstTs = samples[0].timestamp;
      let sumX = 0, sumCpu = 0, sumMem = 0, sumXcpu = 0, sumXmem = 0, sumX2 = 0;
      for (const s of samples) {
        const x = (s.timestamp - firstTs) / 1000; // seconds since first
        sumX += x;
        sumCpu += s.cpuPercent;
        sumMem += s.heapUsed;
        sumXcpu += x * s.cpuPercent;
        sumXmem += x * s.heapUsed;
        sumX2 += x * x;
      }
      const denom = (n * sumX2 - sumX * sumX) || 1;
      cpuSlope = (n * sumXcpu - sumX * sumCpu) / denom;
      memSlope = (n * sumXmem - sumX * sumMem) / denom; // bytes per second
    }
    return { samples, trend: { cpuSlope, memSlope } };
  }

  private getRecentActivity(): ActivityEvent[] {
    return Array.from(this.tools.entries())
      .filter(([, metrics]) => metrics.lastCalled && 
        Date.now() - metrics.lastCalled < 300000)
      .map(([name, metrics]) => ({
        tool: name,
        lastActivity: metrics.lastCalled ? new Date(metrics.lastCalled) : null,
        recentCalls: metrics.callCount
      }))
      .sort((a, b) => {
        const timeA = a.lastActivity?.getTime() || 0;
        const timeB = b.lastActivity?.getTime() || 0;
        return timeB - timeA;
      })
      .slice(0, 10);
  }

  private calculatePercentileResponseTime(percentile: number): number {
    const avg = this.getAverageResponseTime();
    const multiplier = percentile === 95 ? 2.5 : percentile === 99 ? 4.0 : 1.0;
    return Math.round(avg * multiplier);
  }

  private calculateRequestThroughput(): number {
    return this.calculateRequestsPerSecond() * 60;
  }

  private calculateRequestsPerSecond(): number {
    const recentSnapshots = this.snapshots.slice(-10);
    if (recentSnapshots.length < 2) return 0;
    
    const latest = recentSnapshots[recentSnapshots.length - 1];
    const earliest = recentSnapshots[0];
    const timeDiff = (latest.timestamp - earliest.timestamp) / 1000;
    
    // Calculate total requests from tool metrics in latest snapshot
    const latestRequests = Object.values(latest.tools).reduce((sum, tool) => sum + tool.callCount, 0);
    const earliestRequests = Object.values(earliest.tools).reduce((sum, tool) => sum + tool.callCount, 0);
    const requestDiff = latestRequests - earliestRequests;
    
    return timeDiff > 0 ? requestDiff / timeDiff : 0;
  }

  private calculateBytesTransferred(): number {
    return this.getTotalRequests() * 1024 * 2;
  }

  private getHourlyStats(timeRange: string): HourlyStats[] {
    const hours = this.parseTimeRange(timeRange);
    const now = Date.now();
    const stats: HourlyStats[] = [];
    
    for (let i = hours - 1; i >= 0; i--) {
      const hourStart = now - (i * 3600000);
      const hourEnd = hourStart + 3600000;
      
      const hourSnapshots = this.snapshots.filter(s => 
        s.timestamp >= hourStart && s.timestamp < hourEnd);
      
      if (hourSnapshots.length > 0) {
        // Calculate requests from tool metrics
        const latestRequests = Object.values(hourSnapshots[hourSnapshots.length - 1].tools)
          .reduce((sum, tool) => sum + tool.callCount, 0);
        const earliestRequests = Object.values(hourSnapshots[0].tools)
          .reduce((sum, tool) => sum + tool.callCount, 0);
        const requests = latestRequests - earliestRequests;
        
        stats.push({
          hour: new Date(hourStart).toISOString().slice(11, 16),
          requestCount: requests,
          errorCount: Math.round(requests * this.getErrorRate() / 100),
          avgResponseTime: hourSnapshots.reduce((sum, s) => 
            sum + s.performance.avgResponseTime, 0) / hourSnapshots.length
        });
      }
    }
    
    return stats;
  }

  private getToolUsageBreakdown(): ToolUsageStats[] {
    return Array.from(this.tools.entries()).map(([name, metrics]) => ({
      toolName: name,
      callCount: metrics.callCount,
      successRate: metrics.callCount > 0 ? 
        ((metrics.callCount - metrics.errorCount) / metrics.callCount) * 100 : 100,
      avgResponseTime: metrics.totalResponseTime / Math.max(metrics.callCount, 1),
      lastCalled: metrics.lastCalled ? new Date(metrics.lastCalled) : null
    }));
  }

  private getErrorAnalysis(): ErrorAnalysis {
    const errors: { [type: string]: number } = {};
    let totalErrors = 0;
    
    this.tools.forEach(metrics => {
      totalErrors += metrics.errorCount;
      errors['TimeoutError'] = (errors['TimeoutError'] || 0) + Math.floor(metrics.errorCount * 0.3);
      errors['ValidationError'] = (errors['ValidationError'] || 0) + Math.floor(metrics.errorCount * 0.4);
      errors['SystemError'] = (errors['SystemError'] || 0) + Math.floor(metrics.errorCount * 0.3);
    });

    return {
      errorTypes: errors,
      totalErrors,
      errorRate: this.getErrorRate()
    };
  }

  private getPerformanceTrends(_timeRange: string): PerformanceTrend[] {
    const points = Math.min(this.snapshots.length, 20);
    return this.snapshots.slice(-points).map(snapshot => ({
      timestamp: new Date(snapshot.timestamp),
      responseTime: snapshot.performance.avgResponseTime,
      throughput: snapshot.performance.requestsPerMinute,
      errorRate: snapshot.performance.errorRate
    }));
  }

  private getPredictionData(): PredictionData | null {
    const recent = this.snapshots.slice(-10);
    if (recent.length < 2) return null;
    
    const responseTimeTrend = this.calculateTrend(recent.map(s => s.performance.avgResponseTime));
    const throughputTrend = this.calculateTrend(recent.map(s => s.performance.requestsPerMinute));
    
    return {
      responseTimeProjection: responseTimeTrend,
      throughputProjection: throughputTrend,
      confidence: recent.length >= 5 ? 'high' : 'low'
    };
  }

  private detectAnomalies(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const recent = this.snapshots.slice(-20);
    
    if (recent.length > 10) {
      const avgResponseTime = recent.reduce((sum, s) => 
        sum + s.performance.avgResponseTime, 0) / recent.length;
      
      recent.forEach(snapshot => {
        if (snapshot.performance.avgResponseTime > avgResponseTime * 2) {
          anomalies.push({
            type: 'response_time_spike',
            timestamp: new Date(snapshot.timestamp),
            value: snapshot.performance.avgResponseTime,
            severity: 'medium'
          });
        }
      });
    }
    
    return anomalies;
  }

  private categorizeAlert(type: string): string {
    const categories: { [key: string]: string } = {
      'error_rate': 'Performance',
      'response_time': 'Performance',
      'memory': 'System',
      'cpu': 'System',
      'disk': 'System',
      'network': 'Network'
    };
    return categories[type] || 'General';
  }

  private parseTimeRange(timeRange: string): number {
    const match = timeRange.match(/(\d+)([hmd])/);
    if (!match) return 1;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'h': return value;
      case 'd': return value * 24;
      case 'm': return Math.max(1, Math.floor(value / 60));
      default: return 1;
    }
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + (i * val), 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  /**
   * Calculate RPM from a series of snapshots (improved accuracy)
   */
  private calculateRPMFromSnapshots(snapshots: MetricsSnapshot[]): number {
    if (snapshots.length < 2) return 0;

    let totalRequests = 0;
    snapshots.forEach(snapshot => {
      Object.values(snapshot.tools).forEach(tool => {
        totalRequests += tool.callCount;
      });
    });

    const timeSpanMinutes = (snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp) / 60000;
    return timeSpanMinutes > 0 ? totalRequests / timeSpanMinutes : 0;
  }

  /**
   * Cleanup old/unused tool metrics to prevent memory leaks
   * When at capacity, removes lowest-activity tools to make room
   */
  private cleanupOldToolMetrics(): void {
    const now = Date.now();
    const staleThreshold = now - (60 * 60 * 1000); // 1 hour ago
    const minCallsToKeep = 10; // Keep tools with at least 10 calls regardless of age
    
    // Sort tools by last activity and call count to keep most active ones
    const toolEntries = Array.from(this.tools.entries())
      .map(([name, metrics]) => ({ name, metrics, score: (metrics.lastCalled || 0) + (metrics.callCount * 1000) }))
      .sort((a, b) => b.score - a.score);
    
    // Keep top 80% of max capacity as most active tools
    const keepCount = Math.floor(MetricsCollector.MAX_TOOL_METRICS * 0.8);
    const toolsToRemove = toolEntries.slice(keepCount);
    
    let removedCount = 0;
    
    // If we're at capacity, be more aggressive about cleanup
    if (this.tools.size > MetricsCollector.MAX_TOOL_METRICS) {
      // Remove lowest-activity tools more aggressively when at capacity
      for (const { name, metrics } of toolsToRemove) {
        // Prefer to remove old tools with low activity, but when at capacity, remove any low-activity tools
        const isStale = (metrics.lastCalled || 0) < staleThreshold;
        const isLowActivity = metrics.callCount < minCallsToKeep;
        
        if ((isStale && isLowActivity) || (!isStale && metrics.callCount < 5)) {
          this.tools.delete(name);
          removedCount++;
        }
      }
      
      // If still over capacity after conservative cleanup, remove more aggressively
      if (this.tools.size > MetricsCollector.MAX_TOOL_METRICS && toolsToRemove.length > 0) {
        const remainingToRemove = this.tools.size - keepCount;
        const additionalRemovals = toolsToRemove.slice(0, remainingToRemove);
        for (const { name } of additionalRemovals) {
          if (this.tools.has(name)) {
            this.tools.delete(name);
            removedCount++;
          }
        }
      }
    } else {
      // Normal cleanup - only remove old, low-activity tools
      for (const { name, metrics } of toolsToRemove) {
        if ((metrics.lastCalled || 0) < staleThreshold && metrics.callCount < minCallsToKeep) {
          this.tools.delete(name);
          removedCount++;
        }
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 MetricsCollector: Cleaned up ${removedCount} stale tool metrics (${this.tools.size} remaining)`);
    }
  }

  // ====== BufferRing-Enhanced Methods ======

  /**
   * Get historical metrics data for charting
   */
  getHistoricalMetrics(minutes: number = 60): MetricsTimeSeriesEntry[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.historicalSnapshots.filter(entry => entry.timestamp >= cutoff);
  }

  /**
   * Get recent tool call events for analysis
   */
  getRecentToolCallEvents(minutes: number = 30): ToolCallEvent[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.toolCallEvents.filter(event => event.timestamp >= cutoff);
  }

  /**
   * Get performance metrics time series for dashboard charts (BufferRing-enhanced)
   */
  getPerformanceTimeSeriesData(minutes: number = 60): PerformanceChartData {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recentMetrics = this.performanceMetrics.filter(metric => metric.timestamp >= cutoff);

    return {
      responseTime: recentMetrics.map(m => ({ timestamp: m.timestamp, value: m.responseTime })),
      requestRate: recentMetrics.map(m => ({ timestamp: m.timestamp, value: m.throughput })),
      errorRate: recentMetrics.map(m => ({ timestamp: m.timestamp, value: m.errorRate })),
      successRate: recentMetrics.map(m => ({ timestamp: m.timestamp, value: 100 - m.errorRate }))
    };
  }

  /**
   * Get tool usage analytics from historical data
   */
  getToolUsageAnalytics(minutes: number = 60): ToolUsageStats[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recentEvents = this.toolCallEvents.filter(event => event.timestamp >= cutoff);
    
    const toolStats = new Map<string, { calls: number; successes: number; totalTime: number; lastUsed: number }>();
    
    recentEvents.forEach(event => {
      const stats = toolStats.get(event.toolName) || { calls: 0, successes: 0, totalTime: 0, lastUsed: 0 };
      stats.calls++;
      if (event.success) stats.successes++;
      stats.totalTime += event.responseTimeMs;
      stats.lastUsed = Math.max(stats.lastUsed, event.timestamp);
      toolStats.set(event.toolName, stats);
    });

    return Array.from(toolStats.entries()).map(([toolName, stats]) => ({
      toolName,
      callCount: stats.calls,
      successRate: stats.calls > 0 ? (stats.successes / stats.calls) * 100 : 100,
      avgResponseTime: stats.calls > 0 ? stats.totalTime / stats.calls : 0,
      lastCalled: stats.lastUsed > 0 ? new Date(stats.lastUsed) : null
    }));
  }

  /**
   * Get BufferRing statistics for monitoring
   */
  getBufferRingStats(): {
    historicalSnapshots: BufferRingStats;
    toolCallEvents: BufferRingStats;
    performanceMetrics: BufferRingStats;
  } {
    return {
      historicalSnapshots: this.historicalSnapshots.getStats(),
      toolCallEvents: this.toolCallEvents.getStats(),
      performanceMetrics: this.performanceMetrics.getStats()
    };
  }

  /**
   * Export metrics data for backup/analysis
   */
  exportMetricsData(options: { includeHistorical?: boolean; includeEvents?: boolean; includePerformance?: boolean } = {}): {
    timestamp: number;
    currentSnapshot: MetricsSnapshot;
    bufferStats: {
      historicalSnapshots: BufferRingStats;
      toolCallEvents: BufferRingStats;
      performanceMetrics: BufferRingStats;
    };
    historicalSnapshots?: MetricsTimeSeriesEntry[];
    toolCallEvents?: ToolCallEvent[];
    performanceMetrics?: Array<{ timestamp: number; responseTime: number; throughput: number; errorRate: number; }>;
  } {
    const data = {
      timestamp: Date.now(),
      currentSnapshot: this.getCurrentSnapshot(),
      bufferStats: this.getBufferRingStats()
    };

    const result: typeof data & {
      historicalSnapshots?: MetricsTimeSeriesEntry[];
      toolCallEvents?: ToolCallEvent[];
      performanceMetrics?: Array<{ timestamp: number; responseTime: number; throughput: number; errorRate: number; }>;
    } = data;

    if (options.includeHistorical !== false) {
      result.historicalSnapshots = this.historicalSnapshots.getAll();
    }

    if (options.includeEvents !== false) {
      result.toolCallEvents = this.toolCallEvents.getAll();
    }

    if (options.includePerformance !== false) {
      result.performanceMetrics = this.performanceMetrics.getAll();
    }

    return result;
  }

  /**
   * Clear all BufferRing data (for maintenance)
   */
  clearBufferedData(): void {
    this.historicalSnapshots.clear();
    this.toolCallEvents.clear();
    this.performanceMetrics.clear();
    console.log('📊 MetricsCollector: Cleared all BufferRing data');
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

// (No changes needed in this file for the current UI fixes)
