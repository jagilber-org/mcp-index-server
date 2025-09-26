/**
 * ApiRoutes - Phase 1 Dashboard Foundation
 * 
 * Express.js routes for dashboard REST API endpoints.
 * Provides endpoints for metrics, tools, and server status.
 */

import express, { Router, Request, Response } from 'express';
import { buildGraph, GraphExportParams } from '../../services/handlers.graph';
import { ensureLoaded } from '../../services/catalogContext';
import { getWebSocketManager } from './WebSocketManager.js';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector.js';
import { listRegisteredMethods, getHandler } from '../../server/registry.js';
import { getAdminPanel } from './AdminPanel.js';
import fs from 'fs';
import path from 'path';
import { dumpFlags, updateFlags } from '../../services/featureFlags.js';
import { getFlagRegistrySnapshot } from '../../services/handlers.dashboardConfig.js';
import { getRuntimeConfig } from '../../config/runtimeConfig';

export interface ApiRoutesOptions {
  enableCors?: boolean;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
}

export function createApiRoutes(options: ApiRoutesOptions = {}): Router {
  const router = Router();
  const metricsCollector = getMetricsCollector();

  // Synthetic activity runtime state (exposed for active in-flight request tracking)
  let syntheticActiveRequests = 0; // number of in-flight synthetic tool calls
  interface SyntheticSummary { runId: string; executed: number; errors: number; durationMs: number; iterationsRequested: number; concurrency: number; availableCount: number; missingHandlerCount: number; traceReason?: string; timestamp: number; }
  let lastSyntheticSummary: SyntheticSummary | null = null; // persisted summary of last run for status endpoint
  let lastSyntheticRunId: string | null = null;

  // Helper: derive short git commit (best-effort; never throws)
  function getGitCommit(): string | null {
    try {
      const head = path.join(process.cwd(), '.git', 'HEAD');
      if (!fs.existsSync(head)) return null;
      let ref = fs.readFileSync(head, 'utf8').trim();
      if (ref.startsWith('ref:')) {
        const refPath = path.join(process.cwd(), '.git', ref.split(' ')[1]);
        if (fs.existsSync(refPath)) {
          ref = fs.readFileSync(refPath, 'utf8').trim();
        }
      }
      return ref.substring(0, 12);
    } catch { return null; }
  }

  // Helper: approximate build time via dist/server/index.js mtime (falls back to now)
  function getBuildTime(): string | null {
    try {
      const candidate = path.join(process.cwd(), 'dist', 'server', 'index.js');
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        return new Date(stat.mtimeMs).toISOString();
      }
    } catch {/* ignore */}
    return null;
  }

  // CORS middleware (if enabled)
  if (options.enableCors) {
    router.use((_req: Request, res: Response, next: () => void) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });
  }

  // JSON middleware
  router.use(express.json());

  // --- HTTP Metrics Instrumentation ---------------------------------------
  // Previously only MCP tool invocations (via registerHandler wrapper) fed the
  // MetricsCollector, so dashboard performance counters (requestsPerMinute,
  // successRate, avgResponseTime, errorRate) stayed at zero when users only
  // interacted with the REST API. We add lightweight instrumentation here so
  // HTTP requests also contribute. To avoid exploding the per-tool cardinality
  // we aggregate all HTTP traffic under a single pseudo tool id: 'http/request'.
  // This can be disabled by setting MCP_HTTP_METRICS=0.
  try {
    const enableHttpMetrics = getRuntimeConfig().dashboard.http.enableHttpMetrics;
    if (enableHttpMetrics) {
      router.use((req: Request, res: Response, next: () => void) => {
        const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
        res.on('finish', () => {
          try {
            const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
            const ms = Number(endNs - startNs) / 1_000_000;
            const success = res.statusCode < 500;
            // Single aggregated bucket; status >=500 classified as error with http_<code> type
            metricsCollector.recordToolCall('http/request', success, ms, success ? undefined : `http_${res.statusCode}`);
          } catch { /* never block response path */ }
        });
        next();
      });
    }
  } catch { /* ignore instrumentation failures */ }
  // -------------------------------------------------------------------------

  /**
   * GET /api/status - Server status and basic info
   */
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      const git = getGitCommit();
      const buildTime = getBuildTime();
      
  // Prevent stale caching of build/version metadata in browsers / proxies
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        router.post('/admin/maintenance/normalize', async (req: Request, res: Response) => {
          try {
            const { dryRun, forceCanonical } = req.body || {};
            // We call the handler directly (registered via handlers.instructions) ensuring mutation flag is respected.
            const handler = getHandler('instructions/normalize');
            if(!handler){
              return res.status(503).json({ success:false, error:'normalize_tool_unavailable' });
            }
            const started = Date.now();
            const summary = await Promise.resolve(handler({ dryRun: !!dryRun, forceCanonical: !!forceCanonical }));
            const durationMs = Date.now() - started;
            res.json({ success:true, durationMs, dryRun: !!dryRun, forceCanonical: !!forceCanonical, summary });
          } catch(err){
            res.status(500).json({ success:false, error:'normalize_failed', message: err instanceof Error? err.message: String(err) });
          }
        });
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

      res.json({
        status: 'online',
        version: snapshot.server.version,
        build: git || undefined,
        buildTime: buildTime || undefined,
        uptime: snapshot.server.uptime,
        startTime: snapshot.server.startTime,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Status error:', error);
      res.status(500).json({
        error: 'Failed to get server status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/tools - List all registered tools
   */
  router.get('/tools', (_req: Request, res: Response) => {
    try {
      const tools = listRegisteredMethods();
      const toolMetrics = metricsCollector.getToolMetrics() as { [toolName: string]: ToolMetrics };
      
      const enrichedTools = tools.map(toolName => ({
        name: toolName,
        metrics: toolMetrics[toolName] || {
          callCount: 0,
          successCount: 0,
          errorCount: 0,
          totalResponseTime: 0,
          errorTypes: {},
        },
      }));

      res.json({
        tools: enrichedTools,
        totalTools: tools.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Tools error:', error);
      res.status(500).json({
        error: 'Failed to get tools list',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/metrics - Current metrics snapshot
   */
  router.get('/metrics', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      res.json(snapshot);
    } catch (error) {
      console.error('[API] Metrics error:', error);
      res.status(500).json({
        error: 'Failed to get metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/metrics/history - Historical metrics snapshots
   */
  router.get('/metrics/history', (req: Request, res: Response) => {
    try {
      const count = req.query.count ? parseInt(req.query.count as string, 10) : undefined;
      const snapshots = metricsCollector.getSnapshots(count);
      
      res.json({
        snapshots,
        count: snapshots.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Metrics history error:', error);
      res.status(500).json({
        error: 'Failed to get metrics history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/tools/:toolName - Specific tool metrics
   */
  router.get('/tools/:toolName', (req: Request, res: Response) => {
    try {
      const { toolName } = req.params;
      const metrics = metricsCollector.getToolMetrics(toolName);
      
      if (!metrics) {
        return res.status(404).json({
          error: 'Tool not found',
          toolName,
        });
      }

      res.json({
        toolName,
        metrics,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Tool metrics error:', error);
      res.status(500).json({
        error: 'Failed to get tool metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/performance - Performance summary
   */
  router.get('/performance', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      
      res.json({
        performance: snapshot.performance,
        server: {
          uptime: snapshot.server.uptime,
          memoryUsage: snapshot.server.memoryUsage,
          cpuUsage: snapshot.server.cpuUsage,
        },
        connections: snapshot.connections,
        timestamp: snapshot.timestamp,
      });
    } catch (error) {
      console.error('[API] Performance error:', error);
      res.status(500).json({
        error: 'Failed to get performance metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/clear-metrics - Clear all metrics data (admin only)
   */
  router.post('/admin/clear-metrics', (_req: Request, res: Response) => {
    try {
      metricsCollector.clearMetrics();
      
      res.json({
        success: true,
        message: 'Metrics cleared successfully',
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Clear metrics error:', error);
      res.status(500).json({
        error: 'Failed to clear metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/health - Health check endpoint
   */
  router.get('/health', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
  const memUsage = snapshot.server.memoryUsage;
  // Thresholds (configurable via runtime configuration)
  const healthConfig = getRuntimeConfig().metrics.health;
  const memoryThreshold = healthConfig.memoryThreshold;
  const errorRateThreshold = healthConfig.errorRateThreshold;
  const minUptimeMs = healthConfig.minUptimeMs;

      // Simple health indicators (boolean flags)
      const isHealthy = {
        uptime: snapshot.server.uptime >= minUptimeMs,
        memory: (memUsage.heapUsed / Math.max(1, memUsage.heapTotal)) < memoryThreshold,
        errors: snapshot.performance.errorRate < errorRateThreshold,
      } as const;

      const failingChecks = Object.entries(isHealthy)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);

      const overallHealth = failingChecks.length === 0;

      res.status(overallHealth ? 200 : 503).json({
        status: overallHealth ? 'healthy' : 'degraded',
        checks: isHealthy,
        failingChecks,
        thresholds: {
          memoryRatio: memoryThreshold,
            errorRatePercent: errorRateThreshold,
            minUptimeMs
        },
        metrics: {
          uptimeMs: snapshot.server.uptime,
          memory: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            ratio: memUsage.heapTotal ? memUsage.heapUsed / memUsage.heapTotal : 0
          },
          errorRate: snapshot.performance.errorRate
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Health check error:', error);
      res.status(500).json({
        status: 'error',
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
    }
  });

  // ====== Phase 3: Real-time Chart Data Endpoints ======

  /**
   * GET /api/realtime - Real-time metrics for dashboard widgets
   */
  router.get('/realtime', (_req: Request, res: Response) => {
    try {
      const realtimeMetrics = metricsCollector.getRealtimeMetrics();
      res.json({
        success: true,
        data: realtimeMetrics,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Realtime metrics error:', error);
      res.status(500).json({
        error: 'Failed to get realtime metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/tool-usage - Tool usage chart data
   * Query params: minutes (default: 60)
   */
  router.get('/charts/tool-usage', (req: Request, res: Response) => {
    try {
      const minutes = parseInt(req.query.minutes as string) || 60;
      const chartData = metricsCollector.getToolUsageChartData(minutes);
      
      res.json({
        success: true,
        data: chartData,
        timeRange: `${minutes} minutes`,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Tool usage chart error:', error);
      res.status(500).json({
        error: 'Failed to get tool usage chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/performance - Performance metrics chart data
   * Query params: minutes (default: 60)
   */
  router.get('/charts/performance', (req: Request, res: Response) => {
    try {
      const minutes = parseInt(req.query.minutes as string) || 60;
      const chartData = metricsCollector.getPerformanceChartData(minutes);
      
      res.json({
        success: true,
        data: chartData,
        timeRange: `${minutes} minutes`,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Performance chart error:', error);
      res.status(500).json({
        error: 'Failed to get performance chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/timerange - Metrics for specific time ranges
   * Query params: range (1h, 6h, 24h, 7d, 30d)
   */
  router.get('/charts/timerange', (req: Request, res: Response) => {
    try {
      const range = (req.query.range as string) || '1h';
      const validRanges = ['1h', '6h', '24h', '7d', '30d'];
      
      if (!validRanges.includes(range)) {
        return res.status(400).json({
          error: 'Invalid time range',
          message: `Range must be one of: ${validRanges.join(', ')}`,
          validRanges,
        });
      }

      const timeRangeData = metricsCollector.getTimeRangeMetrics(range as '1h' | '6h' | '24h' | '7d' | '30d');
      
      res.json({
        success: true,
        data: timeRangeData,
        range,
        count: timeRangeData.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Time range chart error:', error);
      res.status(500).json({
        error: 'Failed to get time range data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/export - Export chart data for reports
   * Query params: format (json, csv), range (1h, 6h, 24h, 7d, 30d)
   */
  router.get('/charts/export', (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'json';
      const range = (req.query.range as string) || '1h';
      
      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({
          error: 'Invalid export format',
          message: 'Format must be either json or csv',
        });
      }

      const data = metricsCollector.getTimeRangeMetrics(range as '1h' | '6h' | '24h' | '7d' | '30d');
      
      if (format === 'csv') {
        // Convert to CSV format
        const csvHeaders = 'timestamp,activeConnections,requestsPerMinute,successRate,errorRate,avgResponseTime\n';
        const csvRows = data.map(snapshot => 
          `${snapshot.timestamp},${snapshot.connections.activeConnections},${snapshot.performance.requestsPerMinute},${snapshot.performance.successRate},${snapshot.performance.errorRate},${snapshot.performance.avgResponseTime}`
        ).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="metrics-${range}-${Date.now()}.csv"`);
        res.send(csvHeaders + csvRows);
      } else {
        res.json({
          success: true,
          data,
          range,
          exportedAt: Date.now(),
          format: 'json',
        });
      }
    } catch (error) {
      console.error('[API] Chart export error:', error);
      res.status(500).json({
        error: 'Failed to export chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ====== Phase 4: Advanced Real-time & Analytics Endpoints ======

  /**
   * GET /api/streaming/data - Real-time streaming data for Phase 4
   */
  router.get('/streaming/data', (_req: Request, res: Response) => {
    try {
      const streamingData = metricsCollector.getRealtimeStreamingData();
      res.json({
        success: true,
        data: streamingData,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Streaming data error:', error);
      res.status(500).json({
        error: 'Failed to get streaming data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/system/health - Advanced system health metrics
   */
  router.get('/system/health', (_req: Request, res: Response) => {
    try {
      const systemHealth = metricsCollector.getSystemHealth();
      res.json({
        success: true,
        data: systemHealth,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] System health error:', error);
      res.status(500).json({
        error: 'Failed to get system health',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/system/resources - CPU & memory sample history (for long-term monitoring UI)
   * query params: limit (number of most recent samples)
   */
  router.get('/system/resources', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
      const history = metricsCollector.getResourceHistory(limit);
      res.json({
        success: true,
        data: history,
        limit,
        sampleCount: history.samples.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] System resources error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system resource history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/performance/detailed - Enhanced performance metrics
   */
  router.get('/performance/detailed', (_req: Request, res: Response) => {
    try {
      const performanceMetrics = metricsCollector.getDetailedPerformanceMetrics();
      res.json({
        success: true,
        data: performanceMetrics,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Detailed performance error:', error);
      res.status(500).json({
        error: 'Failed to get detailed performance metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/analytics/advanced - Advanced analytics data
   */
  router.get('/analytics/advanced', (req: Request, res: Response) => {
    try {
      const timeRange = (req.query.timeRange as string) || '1h';
      const analytics = metricsCollector.getAdvancedAnalytics(timeRange);
      res.json({
        success: true,
        data: analytics,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Advanced analytics error:', error);
      res.status(500).json({
        error: 'Failed to get advanced analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/alerts/active - Get active alerts
   */
  router.get('/alerts/active', (_req: Request, res: Response) => {
    try {
      const activeAlerts = metricsCollector.getActiveAlerts();
      res.json({
        success: true,
        data: activeAlerts,
        count: activeAlerts.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Active alerts error:', error);
      res.status(500).json({
        error: 'Failed to get active alerts',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/alerts/:id/resolve - Resolve an alert
   */
  router.post('/alerts/:id/resolve', (req: Request, res: Response) => {
    try {
      const alertId = req.params.id;
      const resolved = metricsCollector.resolveAlert(alertId);
      
      if (resolved) {
        res.json({
          success: true,
          message: `Alert ${alertId} resolved successfully`,
          timestamp: Date.now()
        });
      } else {
        res.status(404).json({
          error: 'Alert not found',
          message: `Alert with ID ${alertId} not found`,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Resolve alert error:', error);
      res.status(500).json({
        error: 'Failed to resolve alert',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/alerts/generate - Generate test alert for Phase 4 testing
   */
  router.post('/alerts/generate', (req: Request, res: Response) => {
    try {
      const { type, severity, message, value, threshold } = req.body;
      
      // Basic validation
      if (!type || !severity || !message || value === undefined || threshold === undefined) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['type', 'severity', 'message', 'value', 'threshold'],
          timestamp: Date.now()
        });
      }

      const alert = metricsCollector.generateRealTimeAlert(type, severity, message, value, threshold);
      
      res.json({
        success: true,
        data: alert,
        message: 'Alert generated successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Generate alert error:', error);
      res.status(500).json({
        error: 'Failed to generate alert',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ===== PHASE 4.1 ADMIN PANEL ROUTES =====
  
  const adminPanel = getAdminPanel();

  /**
   * GET /api/admin/config - Get admin configuration
   */
  router.get('/admin/config', (_req: Request, res: Response) => {
    try {
      const config = adminPanel.getAdminConfig();
      // Surface feature flags (environment + file) for visibility
  let featureFlags: Record<string, boolean> = {};
  try { featureFlags = dumpFlags(); } catch { /* ignore */ }
  // Include full registry snapshot for UI (so dashboard shows ALL flags, not just active)
  let allFlags = [] as ReturnType<typeof getFlagRegistrySnapshot>;
  try { allFlags = getFlagRegistrySnapshot(); } catch { /* ignore */ }
      res.json({
        success: true,
        config,
        featureFlags, // currently configured / resolved flags
        allFlags,     // full registry with metadata + parsed values
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Lightweight flags-only endpoint so the UI can retry if /admin/config was served from an older cache.
  router.get('/admin/flags', (_req: Request, res: Response) => {
    try {
      let featureFlags: Record<string, boolean> = {};
      try { featureFlags = dumpFlags(); } catch { /* ignore */ }
      let allFlags = [] as ReturnType<typeof getFlagRegistrySnapshot>;
      try { allFlags = getFlagRegistrySnapshot(); } catch { /* ignore */ }
      res.json({ success:true, featureFlags, allFlags, total: allFlags.length, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success:false, error: 'Failed to get flags snapshot', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/config - Update admin configuration
   */
  router.post('/admin/config', (req: Request, res: Response) => {
    try {
      const updates = req.body;
      const result = adminPanel.updateAdminConfig(updates);
      // Feature flag persistence (optional field featureFlags { name:boolean })
      if (updates.featureFlags && typeof updates.featureFlags === 'object') {
        try { updateFlags(updates.featureFlags); } catch (e) { console.warn('[API] feature flag update failed:', e instanceof Error ? e.message : e); }
      }
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          timestamp: Date.now()
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Update admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update admin configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/sessions - Get active admin sessions
   */
  router.get('/admin/sessions', (_req: Request, res: Response) => {
    try {
      const sessions = adminPanel.getActiveSessions();
      res.json({
        success: true,
        sessions,
        count: sessions.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get admin sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin sessions',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/connections - Get active websocket connections (Phase 4.1 enhancement)
   * Returns a lightweight list derived from metrics snapshot. This intentionally avoids
   * retaining per-connection PII beyond an anonymized id and duration.
   */
  router.get('/admin/connections', (_req: Request, res: Response) => {
    try {
      const wsMgr = getWebSocketManager();
      const connections = wsMgr.getActiveConnectionSummaries();
      res.json({
        success: true,
        connections: connections.sort((a: { connectedAt: number }, b: { connectedAt: number }) => a.connectedAt - b.connectedAt),
        count: connections.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get active connections error:', error);
      res.status(500).json({ success: false, error: 'Failed to get active connections' });
    }
  });

  /**
   * POST /api/admin/sessions - Create new admin session
   */
  router.post('/admin/sessions', (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      
      const session = adminPanel.createAdminSession(userId, ipAddress, userAgent);
      
      res.json({
        success: true,
        session,
        message: 'Admin session created successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Create admin session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create admin session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /api/admin/sessions/:sessionId - Terminate admin session
   */
  router.delete('/admin/sessions/:sessionId', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const terminated = adminPanel.terminateSession(sessionId);
      
      if (terminated) {
        res.json({
          success: true,
          message: 'Admin session terminated successfully',
          timestamp: Date.now()
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session not found',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Terminate admin session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to terminate admin session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/maintenance - Get maintenance information
   */
  router.get('/admin/maintenance', (_req: Request, res: Response) => {
    try {
      const maintenance = adminPanel.getMaintenanceInfo();
      res.json({
        success: true,
        maintenance,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get maintenance info error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get maintenance information',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/maintenance/mode - Set maintenance mode
   */
  router.post('/admin/maintenance/mode', (req: Request, res: Response) => {
    try {
      const { enabled, message } = req.body;
      const result = adminPanel.setMaintenanceMode(enabled, message);
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          timestamp: Date.now()
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Set maintenance mode error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set maintenance mode',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/maintenance/backup - Perform system backup
   */
  router.post('/admin/maintenance/backup', async (_req: Request, res: Response) => {
    try {
      const result = await adminPanel.performBackup();
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          backupId: result.backupId,
          timestamp: Date.now()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Perform backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to perform backup',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/maintenance/backups - List available backups
   */
  router.get('/admin/maintenance/backups', (_req: Request, res: Response) => {
    try {
      const backups = adminPanel.listBackups();
      res.json({ success: true, backups, count: backups.length, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] List backups error:', error);
      res.status(500).json({ success: false, error: 'Failed to list backups', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/maintenance/restore - Restore a backup
   * body: { backupId: string }
   */
  router.post('/admin/maintenance/restore', (req: Request, res: Response) => {
    try {
      const { backupId } = req.body || {};
      const result = adminPanel.restoreBackup(backupId);
      if (result.success) {
        res.json({ success: true, message: result.message, restored: result.restored, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Restore backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to restore backup', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * DELETE /api/admin/maintenance/backup/:id - Delete a specific backup directory
   */
  router.delete('/admin/maintenance/backup/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = adminPanel.deleteBackup(id);
      if (result.success) {
        res.json({ success: true, message: result.message, removed: result.removed, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Delete backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete backup', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/maintenance/backups/prune { retain:number } - retain newest N (0 = delete all)
   */
  router.post('/admin/maintenance/backups/prune', (req: Request, res: Response) => {
    try {
      const retain = typeof req.body?.retain === 'number' ? req.body.retain : 10;
      const result = adminPanel.pruneBackups(retain);
      if (result.success) {
        res.json({ success: true, message: result.message, pruned: result.pruned, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Prune backups error:', error);
      res.status(500).json({ success: false, error: 'Failed to prune backups', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/admin/stats - Get comprehensive admin statistics
   */
  router.get('/admin/stats', (_req: Request, res: Response) => {
    try {
      const stats = adminPanel.getAdminStats();
      res.json({
        success: true,
        stats,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get admin stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/graph/mermaid - Returns mermaid representation of the instruction graph.
   * Query params:
   *   enrich=1        -> include enriched schema (v2) data generation path
   *   categories=1    -> include explicit category nodes
   *   usage=1         -> include usageCount when available
   *   edgeTypes=a,b   -> restrict edge types (comma separated)
   */
  router.get('/graph/mermaid', (req: Request, res: Response) => {
    try {
      const { enrich, categories, usage, edgeTypes, selectedCategories, selectedIds } = req.query as Record<string,string|undefined>;
      const includeEdgeTypes = edgeTypes ? (edgeTypes.split(',').filter(Boolean) as GraphExportParams['includeEdgeTypes']) : undefined;
      const t0 = Date.now();
      try {
        // Lightweight diagnostic log to help identify why client is timing out waiting for mermaid source.
        // Intentionally terse to avoid flooding logs.
        // Example: [graph/mermaid][start] enrich=1 categories=1 usage=0 edgeTypes= selCats= selIds=
        // NOTE: Remove or guard with env flag when stabilized.
        // eslint-disable-next-line no-console
        console.debug('[graph/mermaid][start]', `enrich=${enrich}`, `categories=${categories}`, `usage=${usage}`, `edgeTypes=${edgeTypes||''}`, `selCats=${selectedCategories||''}`, `selIds=${selectedIds||''}`);
  } catch { /* ignore diag logging errors */ }

      // Build full graph first (existing behavior). For very large datasets this is still heavy, but
      // we then apply client-provided narrowing so the same endpoint can power both the legacy
      // monolithic view and the new drilldown coordinated filters.
      const graph = buildGraph({
        enrich: enrich === '1' || enrich === 'true',
        includeCategoryNodes: categories === '1' || categories === 'true',
        includeUsage: usage === '1' || usage === 'true',
        includeEdgeTypes,
        format: 'mermaid'
      });
      if(!graph.mermaid){
        return res.status(500).json({ success:false, error:'failed_to_generate_mermaid'});
      }

      // Optional post-filtering: When selectedCategories or selectedIds are provided we produce a
      // narrowed mermaid diagram. Original implementation used heuristic line scanning which:
      //  1. Failed to match instruction nodes by category (instruction lines rarely contain category text)
      //  2. Dropped frontmatter body, retaining only '---' delimiters (breaking YAML)
      //  3. Did not leverage already-built structured graph (graph.nodes / graph.edges)
      // New approach:
      //  - Build keep set from selectedIds and/or instruction nodes whose categories intersect selectedCategories
      //  - Include explicit category:* nodes for selected categories when category nodes are enabled
      //  - Preserve entire frontmatter block + directive line intact
      //  - Filter node/edge lines strictly by kept ids
      let mermaidSource = graph.mermaid;
      // buildGraph already injects YAML frontmatter + themeVariables; no repair needed now
      const catFilter = selectedCategories?.split(',').filter(Boolean) || [];
      const idFilter = selectedIds?.split(',').filter(Boolean) || [];
      let filteredNodeCount: number | undefined; let filteredEdgeCount: number | undefined; let scoped = false; let keptIdsSize = 0;
      if((catFilter.length || idFilter.length) && mermaidSource){
        try {
          const keepIds = new Set<string>();
          // Always honor explicit id selections
            for(const id of idFilter) keepIds.add(id);
          const wantCategoryNodes = (categories === '1' || categories === 'true');
          if(catFilter.length){
            const catSet = new Set(catFilter.map(c=> c.toLowerCase()));
            // Add explicit category node ids even if no instruction currently selected (contextual anchor)
            if(wantCategoryNodes){
              for(const c of catFilter){ keepIds.add(`category:${c}`); }
            }
            // If enriched, leverage node metadata for precise category membership
            if(graph.meta.graphSchemaVersion === 2){
              type EnrichedNodeLike = { id: string; categories?: string[] };
              for(const nodeRaw of graph.nodes as EnrichedNodeLike[]){
                const nodeCats = nodeRaw.categories;
                if(Array.isArray(nodeCats) && nodeCats.some(c=> catSet.has(c.toLowerCase()))){
                  keepIds.add(nodeRaw.id);
                  if(wantCategoryNodes){
                    for(const c of nodeCats){ if(catSet.has(c.toLowerCase())) keepIds.add(`category:${c}`); }
                  }
                }
              }
            }
          }
          if(keepIds.size){
            // Extract and preserve complete frontmatter (if present) BEFORE line filtering
            let frontmatterBlock = '';
            let remainder = mermaidSource;
            if(remainder.startsWith('---\n')){
              const fmMatch = /^---\n[\s\S]*?\n---\n/.exec(remainder);
              if(fmMatch){
                frontmatterBlock = fmMatch[0];
                remainder = remainder.slice(fmMatch[0].length);
              }
            }
            const lines = remainder.split(/\r?\n/);
            // Capture directive (flowchart TB / graph TD)
            const directiveIdx = lines.findIndex(l=> /^\s*(flowchart|graph)\b/i.test(l));
            let directiveLine = '';
            if(directiveIdx >=0){
              directiveLine = lines[directiveIdx];
            }
            const nodeIdPattern = Array.from(keepIds).map(id=> id.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|');
            const nodeRegex = new RegExp(`^(\\s*)(${nodeIdPattern})\\[`);
            const edgeRegex = new RegExp(`^(.*)(${nodeIdPattern})(.*)(${nodeIdPattern})(.*)$`);
            const filtered: string[] = [];
            const styleRegexes = [
              /^\s*classDef\s+/i,
              /^\s*style\s+[A-Za-z0-9:_-]+\s+/i,
              /^\s*class\s+[A-Za-z0-9:_-]+\s+/i,
              /^\s*linkStyle\s+\d+/i
            ];
            for(const ln of lines){
              if(!ln) continue;
              if(directiveLine && ln === directiveLine){ continue; } // we'll add once later
              const trimmed = ln.trim();
              if(trimmed.startsWith('%%')) { filtered.push(ln); continue; }
              // Preserve style/class directives globally so visual theming remains after scoping
              if(styleRegexes.some(r=> r.test(trimmed))){ filtered.push(ln); continue; }
              if(nodeRegex.test(ln) || edgeRegex.test(ln)) filtered.push(ln);
            }
            const parts: string[] = [];
            if(frontmatterBlock) parts.push(frontmatterBlock.trimEnd());
            if(directiveLine) parts.push(directiveLine);
            parts.push(...filtered);
            mermaidSource = parts.join('\n');
            if (getRuntimeConfig().logging.verbose){
              // eslint-disable-next-line no-console
              console.debug('[graph/mermaid][filter:new]', { selectedIds: idFilter.length, selectedCategories: catFilter.length, kept: keepIds.size, totalLines: lines.length, emittedLines: parts.length });
            }
            // Derive filtered counts (approximate by scanning filtered lines for node and edge patterns)
            keptIdsSize = keepIds.size; scoped = true;
            try {
              const nodeLineRegex = /^(\s*)([A-Za-z0-9:_-]+)\[[^\]]*\]/;
              const edgeLineRegex = /-->|===|~~>|\|-/; // heuristic for mermaid edge connectors
              let n=0,eCnt=0; for(const ln of filtered){ if(nodeLineRegex.test(ln)) n++; else if(edgeLineRegex.test(ln)) eCnt++; }
              filteredNodeCount = n; filteredEdgeCount = eCnt; }
            catch{ /* ignore count derivation errors */ }
          }
        } catch(filterErr){
          console.warn('[graph/mermaid][filter-failed]', filterErr);
        }
      }
      try {
        // eslint-disable-next-line no-console
        console.debug('[graph/mermaid][ok]', { ms: Date.now()-t0, nodes: graph.meta?.nodeCount, edges: graph.meta?.edgeCount, bytes: mermaidSource.length });
  } catch { /* ignore diag logging errors */ }
      // If scoped, clone meta to reflect filtered counts while preserving original for potential debugging.
      let metaOut: typeof graph.meta = graph.meta;
      if(scoped && graph.meta){
        try {
          type GraphMetaType = typeof graph.meta;
          const base: GraphMetaType = { ...graph.meta } as GraphMetaType; // preserve required fields
          const augmented = base as GraphMetaType & { scoped?: boolean; keptIds?: number };
          if(typeof filteredNodeCount === 'number') (augmented as { nodeCount: number }).nodeCount = filteredNodeCount;
          if(typeof filteredEdgeCount === 'number') (augmented as { edgeCount: number }).edgeCount = filteredEdgeCount;
          augmented.scoped = true;
          augmented.keptIds = keptIdsSize;
          metaOut = augmented;
        } catch { /* ignore meta cloning issues */ }
      }
      res.json({ success:true, meta: metaOut, mermaid: mermaidSource });
    } catch(err){
      const e = err as Error;
      try {
        // eslint-disable-next-line no-console
        console.warn('[graph/mermaid][error]', e.message);
  } catch { /* ignore diag logging errors */ }
      res.status(500).json({ success:false, error: String(e.message||e) });
    }
  });

  // ---------------------------------------------------------------------------
  // Lightweight Drilldown Graph Endpoints (for dynamic layered SVG rendering)
  // These endpoints intentionally return minimal JSON to avoid generating a
  // large monolithic Mermaid diagram that can fail to render for complex
  // catalogs. The client composes small SVG layers on demand.
  // ---------------------------------------------------------------------------

  /**
   * GET /api/graph/categories
   * Returns list of unique categories with instruction counts.
   * Optional query: q=partial (case-insensitive contains filter)
   */
  router.get('/graph/categories', (_req: Request, res: Response) => {
    try {
      const st = ensureLoaded();
      const map = new Map<string, number>();
      for(const inst of st.list){
        const cats = Array.isArray(inst.categories)? inst.categories : [];
        for(const c of cats){ map.set(c, (map.get(c)||0)+1); }
      }
      const categories = [...map.entries()].sort((a,b)=> a[0].localeCompare(b[0])).map(([id,count])=> ({ id, count }));
      res.json({ success:true, categories, total: categories.length, timestamp: Date.now() });
    } catch(err){
      const e = err as Error; res.status(500).json({ success:false, error: e.message||String(e) });
    }
  });

  /**
   * GET /api/graph/instructions?categories=a,b&limit=100
   * Returns lightweight instruction list filtered by categories (OR semantics).
   */
  router.get('/graph/instructions', (req: Request, res: Response) => {
    try {
      const st = ensureLoaded();
      const catsParam = (req.query.categories as string|undefined) || '';
      const filterCats = catsParam? catsParam.split(',').filter(Boolean) : [];
      const limitRaw = parseInt((req.query.limit as string)||'0',10);
      const limit = Number.isFinite(limitRaw) && limitRaw>0? limitRaw : 500;
      let instructions = st.list.slice().sort((a,b)=> a.id.localeCompare(b.id));
      if(filterCats.length){
        const set = new Set(filterCats.map(c=> c.toLowerCase()));
        instructions = instructions.filter(i=> (i.categories||[]).some(c=> set.has(c.toLowerCase())));
      }
      instructions = instructions.slice(0, limit);
      const flat = instructions.map(i=> ({ id: i.id, primaryCategory: i.primaryCategory || i.categories?.[0], categories: i.categories||[] }));
      res.json({ success:true, instructions: flat, count: flat.length, filtered: !!filterCats.length, timestamp: Date.now() });
    } catch(err){
      const e = err as Error; res.status(500).json({ success:false, error: e.message||String(e) });
    }
  });

  /**
   * GET /api/graph/relations?instructions=id1,id2
   * Returns minimal edges among the provided instruction ids plus category linkage.
   * Includes category nodes actually referenced (for client labeling/placement).
   */
  router.get('/graph/relations', (req: Request, res: Response) => {
    try {
      const idsParam = (req.query.instructions as string|undefined)||'';
      const ids = idsParam.split(',').filter(Boolean);
      if(!ids.length){ return res.json({ success:true, nodes:[], edges:[], categories:[], timestamp: Date.now() }); }
      // Reuse buildGraph enriched with category nodes + belongs edges then filter.
      const graph = buildGraph({ enrich:true, includeCategoryNodes:true, includeUsage:false });
      const expand = (req.query.expand === '1' || req.query.expand === 'true');
      const selectedSet = new Set(ids);
  const workingSet = new Set(ids); // may expand with one-hop neighbors
      // First pass edges (incident to selected)
  const firstEdges = graph.edges.filter(e=> selectedSet.has(e.from) || selectedSet.has(e.to));
      if(expand){
        // Identify one-hop neighbor instruction ids not already selected
  const instructionNodeIds = new Set(graph.nodes.filter(n=> (n as { nodeType?: string }).nodeType==='instruction').map(n=> n.id));
        for(const e of firstEdges){
          if(instructionNodeIds.has(e.from) && !workingSet.has(e.from)) workingSet.add(e.from);
          if(instructionNodeIds.has(e.to) && !workingSet.has(e.to)) workingSet.add(e.to);
        }
      }
      // Nodes: any instruction in workingSet plus category nodes (we'll prune unused categories)
  const nodesAll = graph.nodes.filter(n=> workingSet.has(n.id) || (n as { nodeType?: string }).nodeType==='category');
      // Edges: restrict to those whose endpoints are in workingSet and at least one endpoint in selectedSet (keeps visual focus)
      const edges = graph.edges.filter(e=> workingSet.has(e.from) && workingSet.has(e.to) && (selectedSet.has(e.from) || selectedSet.has(e.to)));
      const categoryRefs = new Set<string>();
      for(const e of edges){
        if(e.type==='belongs' || e.type==='primary'){
          if(e.to.startsWith('category:')) categoryRefs.add(e.to);
          if(e.from.startsWith('category:')) categoryRefs.add(e.from);
        }
      }
  const finalNodes = nodesAll.filter(n=> !('nodeType' in n && (n as { nodeType?: string }).nodeType==='category') || categoryRefs.has(n.id));
      const categories = [...categoryRefs].map(id=> ({ id: id.replace(/^category:/,'' ) }));
      const expandedCount = workingSet.size - selectedSet.size;
      res.json({ success:true, nodes: finalNodes, edges, categories, expanded: expand ? expandedCount : 0, timestamp: Date.now() });
    } catch(err){
      const e = err as Error; res.status(500).json({ success:false, error: e.message||String(e) });
    }
  });
  // ---------------------------------------------------------------------------

  /**
   * GET /api/admin/sessions/history - Historical admin sessions (bounded)
   */
  router.get('/admin/sessions/history', (req: Request, res: Response) => {
    try {
      const limitParam = req.query.limit as string | undefined;
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const history = adminPanel.getSessionHistory(limit);
      res.json({
        success: true,
        history,
        count: history.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get session history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get session history',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/synthetic/activity - Generate synthetic tool activity to exercise metrics
   * body: { iterations?: number, concurrency?: number }
   */
  router.post('/admin/synthetic/activity', async (req: Request, res: Response) => {
    try {
      const iterations = Math.min(Math.max(parseInt(req.body.iterations || '10', 10), 1), 500);
      const concurrency = Math.min(Math.max(parseInt(req.body.concurrency || '2', 10), 1), 25);
      const start = Date.now();
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const wantTrace = req.query.trace === '1' || req.body?.trace === true || req.query.debug === '1' || req.body?.debug === true;
  const wantStream = wantTrace && (req.query.stream === '1' || req.body?.stream === true); // explicit opt-in for streaming

      // Whitelist of safe, read-only or idempotent methods + minimal params
      const PARAM_MAP: Record<string, unknown> = {
        'health/check': {},
        'metrics/snapshot': {},
        'meta/tools': {},
        'gates/evaluate': {},
        // instruction CRUD via dispatch (kept minimal and id-namespaced)
        'instructions/dispatch:add': { action: 'add', entry: { id: `synthetic-${runId}`, title: 'Synthetic Instruction', body: 'Temporary synthetic entry', audience: 'all', requirement: 'optional', priority: 'low', categories: ['synthetic'], owner: 'synthetic' }, overwrite: true, lax: true },
        'instructions/dispatch:get': { action: 'get', id: `synthetic-${runId}` },
        'instructions/dispatch:list': { action: 'list' },
        'instructions/dispatch:query': { action: 'query', keyword: 'Synthetic', categoriesAll: [], requirement: undefined },
        'instructions/dispatch:update': { action: 'add', entry: { id: `synthetic-${runId}`, title: 'Synthetic Instruction Updated', body: 'Updated body', audience: 'all', requirement: 'optional', priority: 'medium', categories: ['synthetic','updated'], owner: 'synthetic' }, overwrite: true, lax: true },
        'instructions/dispatch:remove': { action: 'remove', id: `synthetic-${runId}` },
        // usage tracking for variety
        'usage/track': { id: 'synthetic.activity' }
      };

      const allRegistered = listRegisteredMethods();
      // Expand synthetic dispatch action keys to actual tool name for resolution
      const expandedParamEntries = Object.entries(PARAM_MAP).map(([k,v]) => {
        if (k.startsWith('instructions/dispatch:')) return ['instructions/dispatch', v] as const;
        return [k,v] as const;
      });
      const available = allRegistered.filter(m => expandedParamEntries.some(([name]) => name === m));
      if (!available.length) {
        return res.status(503).json({
          success: false,
          error: 'No safe tools available for synthetic activity',
          registeredCount: allRegistered.length,
            // surface first few for quick visual triage without flooding
          registeredSample: allRegistered.slice(0, 15),
          expectedAnyOf: Object.keys(PARAM_MAP),
          hint: 'If this persists, ensure handlers.* imports occur before dashboard start (see server/index.ts import order).',
          timestamp: Date.now()
        });
      }

  let executed = 0;
  let errors = 0;
  let missingHandlerCount = 0;
  const traces: Array<{ method: string; success: boolean; durationMs: number; started: number; ended: number; error?: string; skipped?: boolean; }> = [];

      let seq = 0;
      const wsManager = wantStream ? getWebSocketManager() : null;
      const runOne = async () => {
        // Pick one expanded entry (so dispatch variants get distinct params)
        const picked = expandedParamEntries[Math.floor(Math.random() * expandedParamEntries.length)];
        const method = picked[0];
        if (!available.includes(method)) return; // skip if not actually registered
        const payload = picked[1];
        const handler = getHandler(method);
        const started = Date.now();
        try {
          syntheticActiveRequests++;
          if (handler) {
            await Promise.resolve(handler(payload));
            const ended = Date.now();
            if (wantTrace && traces.length < iterations) traces.push({ method, success: true, durationMs: ended - started, started, ended });
            if (wantStream && wsManager) {
              try { wsManager.broadcast({ type: 'synthetic_trace', timestamp: Date.now(), data: { runId, seq: ++seq, total: iterations, method, success: true, durationMs: ended - started, started, ended } }); } catch {/* ignore */}
            }
          } else {
            // Record a synthetic trace so the UI can surface why nothing appeared
            missingHandlerCount++;
            const ended = Date.now();
            if (wantTrace && traces.length < iterations) traces.push({ method, success: false, durationMs: ended - started, started, ended, error: 'handler_not_registered', skipped: true });
            if (wantStream && wsManager) {
              try { wsManager.broadcast({ type: 'synthetic_trace', timestamp: Date.now(), data: { runId, seq: ++seq, total: iterations, method, success: false, durationMs: ended - started, started, ended, error: 'handler_not_registered', skipped: true } }); } catch {/* ignore */}
            }
          }
        } catch (err) {
          errors++;
          const ended = Date.now();
          if (wantTrace && traces.length < iterations) traces.push({ method, success: false, durationMs: ended - started, started, ended, error: err instanceof Error ? err.message : String(err) });
          if (wantStream && wsManager) {
            try { wsManager.broadcast({ type: 'synthetic_trace', timestamp: Date.now(), data: { runId, seq: ++seq, total: iterations, method, success: false, durationMs: ended - started, started, ended, error: err instanceof Error ? err.message : String(err) } }); } catch {/* ignore */}
          }
        }
        executed++;
        syntheticActiveRequests--;
      };

      // Concurrency control
      const inFlight: Promise<void>[] = [];
      for (let i = 0; i < iterations; i++) {
        if (inFlight.length >= concurrency) {
          await Promise.race(inFlight);
        }
        const p = runOne().finally(() => {
          const idx = inFlight.indexOf(p);
          if (idx >= 0) inFlight.splice(idx, 1);
        });
        inFlight.push(p);
      }
      await Promise.all(inFlight);

      const durationMs = Date.now() - start;
      const debug = req.query.debug === '1' || req.body?.debug === true;
      const traceReason = wantTrace && traces.length === 0
        ? (available.length === 0
            ? 'no_safe_tools_registered'
            : missingHandlerCount === iterations
              ? 'all_selected_handlers_missing'
              : 'no_traces_captured')
        : undefined;
      lastSyntheticRunId = runId;
      lastSyntheticSummary = {
        runId,
        executed,
        errors,
        durationMs,
        iterationsRequested: iterations,
        concurrency,
        availableCount: available.length,
        missingHandlerCount,
        traceReason,
        timestamp: Date.now()
      };
      syntheticActiveRequests = 0; // safety reset
      res.json({
        success: true,
        message: 'Synthetic activity completed',
        runId,
        executed,
        errors,
        durationMs,
        iterationsRequested: iterations,
        concurrency,
        availableCount: available.length,
        missingHandlerCount,
        ...(traceReason ? { traceReason } : {}),
        ...(debug ? { available } : {}),
        ...(wantTrace ? { traces } : {}),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Synthetic activity error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to run synthetic activity',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/synthetic/status - real-time synthetic run status (active in-flight requests)
   */
  router.get('/admin/synthetic/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      activeRequests: syntheticActiveRequests,
      lastRunId: lastSyntheticRunId,
      lastSummary: lastSyntheticSummary,
      timestamp: Date.now()
    });
  });

  /**
   * GET /api/performance/detailed - Extended performance metrics (UI convenience endpoint)
   * Supplies the fields the dashboard Monitoring panel expects without the client
   * needing to stitch multiple endpoints. P95/P99 are approximations until full
   * latency histogram support is implemented.
   */
  router.get('/performance/detailed', (_req: Request, res: Response) => {
    try {
      const snap = metricsCollector.getCurrentSnapshot();
      // Approximate p95 by avgResponseTime + (errorRate factor) as a placeholder; real implementation would use distribution.
      const avg = snap.performance.avgResponseTime;
      const p95 = avg ? Math.round(avg * 1.35) : 0;
    res.json({
        success: true,
        data: {
          requestThroughput: snap.performance.requestsPerMinute,
          averageResponseTime: avg,
          p95ResponseTime: p95,
          errorRate: snap.performance.errorRate,
          concurrentConnections: snap.connections.activeConnections,
      successRate: snap.performance.successRate ?? (100 - snap.performance.errorRate),
      activeSyntheticRequests: typeof syntheticActiveRequests === 'number' ? syntheticActiveRequests : 0
        },
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to compute performance metrics', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /api/admin/restart - Restart server components
   */
  router.post('/admin/restart', async (req: Request, res: Response) => {
    try {
      const { component = 'all' } = req.body;
      const result = await adminPanel.restartServer(component);
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          timestamp: Date.now()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Restart server error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to restart server',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/cache/clear - Clear server caches
   */
  router.post('/admin/cache/clear', (_req: Request, res: Response) => {
    try {
      const result = adminPanel.clearCaches();
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          cleared: result.cleared,
          timestamp: Date.now()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Clear caches error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear caches',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ===== Instruction Management Routes =====
  const resolveInstructionsDir = (): string => {
    const config = getRuntimeConfig();
    const configured = config.dashboard.admin.instructionsDir || config.catalog.baseDir;
    return configured && configured.trim().length ? configured : path.join(process.cwd(), 'instructions');
  };

  function ensureInstructionsDir(): string {
    const instructionsDir = resolveInstructionsDir();
    try {
      if (!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });
    } catch (e) {
      // ignore
    }
    return instructionsDir;
  }

  /**
   * GET /api/instructions - list instruction JSON files
   */
  router.get('/instructions', (_req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const classify = (basename: string): { category: string; sizeCategory: string } => {
        const lower = basename.toLowerCase();
        let category = 'general';
        if (lower.startsWith('alpha')) category = 'alpha';
        else if (lower.startsWith('beta')) category = 'beta';
        else if (lower.includes('seed')) category = 'seed';
        else if (lower.includes('enterprise')) category = 'enterprise';
        else if (lower.includes('dispatcher')) category = 'dispatcher';
        return { category, sizeCategory: 'small' }; // size bucket adjusted after stat
      };

      const files = fs.readdirSync(instructionsDir)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => {
          const abs = path.join(instructionsDir, f);
          const stat = fs.statSync(abs);
          const base = f.replace(/\.json$/i, '');
          const meta = classify(base);
          const sizeCategory = stat.size < 1024 ? 'small' : (stat.size < 5 * 1024 ? 'medium' : 'large');

          let primaryCategory = meta.category;
          let categories: string[] = [];
          let semanticSummary: string | undefined;
          try {
            // Parse file and extract categories/category fields if present.
            // This enables multi-category filtering in the dashboard. Failures are non-fatal.
            const raw = fs.readFileSync(abs, 'utf8');
            // Quick guard: avoid parsing extremely large instruction files (>1MB) for perf.
            if (raw.length < 1_000_000) {
              const json = JSON.parse(raw) as unknown;
              const getProp = (obj: unknown, key: string): unknown => {
                if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
                  return (obj as Record<string, unknown>)[key];
                }
                return undefined;
              };
              const rawCats = getProp(json, 'categories');
              if (Array.isArray(rawCats)) {
                categories = rawCats
                  .filter((c: unknown): c is string => typeof c === 'string')
                  .map(c => c.trim())
                  .filter(c => !!c);
              }
              const rawPrimary = getProp(json, 'category');
              if (typeof rawPrimary === 'string') {
                const c = rawPrimary.trim();
                if (c) primaryCategory = c;
                if (c && !categories.includes(c)) categories.push(c);
              }
              const meta = getProp(json, 'meta');
              if (meta && typeof meta === 'object') {
                const metaPrimary = getProp(meta, 'category');
                if (typeof metaPrimary === 'string') {
                  const c = metaPrimary.trim();
                  if (c) primaryCategory = c;
                  if (c && !categories.includes(c)) categories.push(c);
                }
                const metaCats = getProp(meta, 'categories');
                if (Array.isArray(metaCats)) {
                  for (const c of metaCats) {
                    if (typeof c === 'string') {
                      const norm = c.trim();
                      if (norm && !categories.includes(norm)) categories.push(norm);
                    }
                  }
                }
                // meta-level semantic summary
                const metaSummary = getProp(meta, 'semanticSummary');
                if (typeof metaSummary === 'string' && metaSummary.trim()) semanticSummary = metaSummary.trim();
              }
              // top-level semantic summary
              if (!semanticSummary) {
                const topSummary = getProp(json, 'semanticSummary');
                if (typeof topSummary === 'string' && topSummary.trim()) semanticSummary = topSummary.trim();
              }
              // fallback: description or body first line truncated
              if (!semanticSummary) {
                const desc = getProp(json, 'description');
                if (typeof desc === 'string' && desc.trim()) semanticSummary = desc.trim();
              }
              if (!semanticSummary) {
                const body = getProp(json, 'body');
                if (typeof body === 'string' && body.trim()) {
                  const firstLine = body.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)[0];
                  if (firstLine) semanticSummary = firstLine;
                }
              }
              if (semanticSummary) {
                // normalize length to avoid huge payloads in list view
                if (semanticSummary.length > 400) semanticSummary = semanticSummary.slice(0, 400) + '…';
              }
            }
          } catch {
            // ignore parse errors; fall back to heuristic classification only
          }

          // Normalize final category fields
          if (!categories.length && primaryCategory) categories = [primaryCategory];
          // Deduplicate while preserving order
          categories = Array.from(new Set(categories));

          return {
            name: base,
            size: stat.size,
            mtime: stat.mtimeMs,
            category: primaryCategory,
            categories,
            sizeCategory,
            semanticSummary,
          };
        });

      res.json({ success: true, instructions: files, count: files.length, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to list instructions', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/instructions/search?q=term&limit=20
   * Lightweight substring search across instruction id/name, title, body and categories.
   * Intended as a fallback when richer semantic tools return no matches.
   * Returns at most `limit` (default 20, max 100) items with a small context snippet highlighting the first match.
   * Response shape: { success:true, query, count, results:[ { name, categories, size, mtime, snippet } ] }
  * Notes:
  * - Performs simple case-insensitive substring checks; no tokenization/stemming.
  * - Skips parsing JSON bodies larger than 1MB for safety/perf (still coarse scans raw text).
  * - Snippet window ~120 chars either side of first match with naive **highlight** markup consumed client-side into <mark>.
  * - Designed as a resiliency / last-mile discovery aid when semantic index unavailable.
   */
  router.get('/instructions/search', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const qRaw = String(req.query.q || '').trim();
      const query = qRaw.slice(0, 256); // guard length
      const limitRaw = parseInt(String(req.query.limit||'20'), 10);
      const limit = Math.min(100, Math.max(1, isNaN(limitRaw)? 20 : limitRaw));
      if(!query || query.length < 2){
        return res.json({ success:true, query, count:0, results:[], note:'query_too_short' });
      }
      const qLower = query.toLowerCase();
  const files = fs.readdirSync(instructionsDir).filter(f=> f.toLowerCase().endsWith('.json'));
      const results: Array<{ name:string; categories:string[]; size:number; mtime:number; snippet:string }> = [];
      for(const f of files){
        if(results.length >= limit) break;
        try {
          const abs = path.join(instructionsDir, f);
            const raw = fs.readFileSync(abs, 'utf8');
            // Quick coarse filter before JSON parse to reduce cost on large sets
            const coarse = raw.toLowerCase();
            if(!coarse.includes(qLower)){
              // Still parse minimal header fields just in case name or categories match
              const nameOnly = f.replace(/\.json$/i,'');
              if(!nameOnly.toLowerCase().includes(qLower)) continue;
            }
            let parsed: unknown = null;
            try { if(raw.length < 1_000_000) parsed = JSON.parse(raw); } catch { /* ignore parse errors */ }

            interface ParsedInstructionLite { title?: unknown; body?: unknown; categories?: unknown; description?: unknown }
            const asParsed = (obj: unknown): ParsedInstructionLite | undefined => {
              return obj && typeof obj === 'object' ? obj as ParsedInstructionLite : undefined;
            };
            const pi = asParsed(parsed);

            const name = f.replace(/\.json$/i,'');
            let categories: string[] = [];
            if (pi && Array.isArray(pi.categories)) {
              categories = pi.categories.filter((c: unknown): c is string => typeof c === 'string').slice(0,10);
            }
            // Determine if match actually present across fields
            const haystacks: string[] = [name];
            if(pi){
              if(typeof pi.title === 'string') haystacks.push(pi.title);
              if(typeof pi.body === 'string') haystacks.push(pi.body);
              if(Array.isArray(pi.categories)) haystacks.push(pi.categories.join(' '));
              if(typeof pi.description === 'string') haystacks.push(pi.description);
            } else {
              // fallback raw limited content check
              haystacks.push(raw.slice(0, 20_000));
            }
            const joined = haystacks.join('\n').toLowerCase();
            const idx = joined.indexOf(qLower);
            if(idx === -1) continue;
            // Build snippet around first match (collapse newlines)
            const snippetWindow = 120;
            const start = Math.max(0, idx - snippetWindow);
            const end = Math.min(joined.length, idx + qLower.length + snippetWindow);
            let snippet = joined.slice(start, end).replace(/\s+/g,' ').trim();
            // Highlight match (simple)
            snippet = snippet.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i'), m=> `**${m}**`);
            const stat = fs.statSync(abs);
            results.push({ name, categories, size: stat.size, mtime: stat.mtimeMs, snippet });
        } catch(err){ /* skip file on error */ }
      }
      res.json({ success:true, query, count: results.length, results, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] instructions search error:', error);
      res.status(500).json({ success:false, error:'search_failed', message: error instanceof Error? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/instructions/categories - get dynamic categories from actual instructions
   */
  router.get('/instructions/categories', async (_req: Request, res: Response) => {
    try {
      // Use the instruction handler's categories action to get actual categories
      const instructionHandler = getHandler('instructions/dispatch');
      if (!instructionHandler) {
        return res.status(500).json({ success: false, error: 'Instruction handler not available' });
      }
      
      const result = await instructionHandler({ 
        action: 'categories' 
      }) as { categories?: Array<{ name: string; count: number }>; count?: number };
      
      res.json({ 
        success: true, 
        categories: result?.categories || [], 
        count: result?.count || 0,
        timestamp: Date.now() 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get categories', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  /**
   * GET /api/instructions/:name - get single instruction content
   */
  router.get('/instructions/:name', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const file = path.join(instructionsDir, req.params.name + '.json');
      if (!fs.existsSync(file)) return res.status(404).json({ success:false, error:'Not found' });
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      res.json({ success: true, content, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success:false, error:'Failed to load instruction', message: error instanceof Error? error.message:'Unknown error' });
    }
  });

  /**
   * POST /api/instructions - create new instruction
   * body: { name, content }
   */
  router.post('/instructions', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const { name, content } = req.body || {};
      if (!name || !content) return res.status(400).json({ success:false, error:'Missing name or content' });
      const safeName = String(name).replace(/[^a-zA-Z0-9-_]/g,'-');
      const file = path.join(instructionsDir, safeName + '.json');
      if (fs.existsSync(file)) return res.status(409).json({ success:false, error:'Instruction already exists' });
      fs.writeFileSync(file, JSON.stringify(content, null, 2));
      res.json({ success:true, message:'Instruction created', name: safeName, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success:false, error:'Failed to create instruction', message: error instanceof Error? error.message:'Unknown error' });
    }
  });

  /**
   * PUT /api/instructions/:name - update existing instruction
   */
  router.put('/instructions/:name', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const { content } = req.body || {};
      const name = req.params.name;
      if (!content) return res.status(400).json({ success:false, error:'Missing content' });
      const file = path.join(instructionsDir, name + '.json');
      if (!fs.existsSync(file)) return res.status(404).json({ success:false, error:'Not found' });
      fs.writeFileSync(file, JSON.stringify(content, null, 2));
      res.json({ success:true, message:'Instruction updated', timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success:false, error:'Failed to update instruction', message: error instanceof Error? error.message:'Unknown error' });
    }
  });

  /**
   * DELETE /api/instructions/:name - delete instruction
   */
  router.delete('/instructions/:name', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const file = path.join(instructionsDir, req.params.name + '.json');
      if (!fs.existsSync(file)) return res.status(404).json({ success:false, error:'Not found' });
      fs.unlinkSync(file);
      res.json({ success:true, message:'Instruction deleted', timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success:false, error:'Failed to delete instruction', message: error instanceof Error? error.message:'Unknown error' });
    }
  });

  /**
   * GET /api/logs - Get server logs with optional tail functionality
   */
  router.get('/logs', (req: Request, res: Response) => {
    try {
      const loggingConfig = getRuntimeConfig().logging;
      const logFile = loggingConfig.file;
      const lines = req.query.lines ? parseInt(req.query.lines as string, 10) : 100;
      const follow = req.query.follow === 'true';
  const raw = req.query.raw === '1' || req.query.raw === 'true';
      
      if (!logFile || !fs.existsSync(logFile)) {
        return res.json({
          logs: [],
          message: 'No log file configured or file not found. Set MCP_LOG_FILE environment variable or update runtime logging configuration.',
          timestamp: Date.now(),
          totalLines: 0
        });
      }

      // Read log file
      const logContent = fs.readFileSync(logFile, 'utf8');
      const allLines = logContent.split('\n').filter(line => line.trim());
      
      // Get last N lines (tail functionality)
      const tailLines = lines > 0 ? allLines.slice(-lines) : allLines;
      
      if (raw) {
        // Plain text response for simpler clients (backwards-compatible option)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(tailLines.join('\n'));
        return;
      }

      res.json({
        logs: tailLines,
        timestamp: Date.now(),
        totalLines: allLines.length,
        showing: tailLines.length,
        file: loggingConfig.rawFileValue ?? logFile,
        follow: follow,
        mode: raw ? 'text' : 'json'
      });
      
    } catch (error) {
      console.error('[API] Logs error:', error);
      res.status(500).json({
        error: 'Failed to read logs',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
    }
  });

  /**
   * GET /api/logs/stream - Server-Sent Events stream for real-time log tailing
   */
  router.get('/logs/stream', (req: Request, res: Response) => {
    const loggingConfig = getRuntimeConfig().logging;
    const logFile = loggingConfig.file;
    
    if (!logFile || !fs.existsSync(logFile)) {
      return res.status(404).json({
        error: 'Log file not available',
        message: 'No log file configured or file not found. Set MCP_LOG_FILE environment variable or update runtime logging configuration.'
      });
    }

    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    let lastSize = 0;
    let watchInterval: NodeJS.Timeout | null = null;

    try {
      // Get initial file size
      const initialStats = fs.statSync(logFile);
      lastSize = initialStats.size;

      // Send initial connection message
      res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

      // Poll for file changes (more reliable than fs.watchFile)
      watchInterval = setInterval(() => {
        try {
          const currentStats = fs.statSync(logFile);
          if (currentStats.size > lastSize) {
            // File has grown, read new content
            const stream = fs.createReadStream(logFile, { 
              start: lastSize, 
              end: currentStats.size - 1,
              encoding: 'utf8'
            });

            let buffer = '';
            stream.on('data', (chunk: string | Buffer) => {
              const chunkStr = chunk.toString();
              buffer += chunkStr;
              const lines = buffer.split('\n');
              buffer = lines.pop() || ''; // Keep incomplete line in buffer

              lines.forEach(line => {
                if (line.trim()) {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'log', 
                    line: line.trim(), 
                    timestamp: Date.now() 
                  })}\n\n`);
                }
              });
            });

            stream.on('end', () => {
              lastSize = currentStats.size;
            });

            stream.on('error', (error) => {
              res.write(`data: ${JSON.stringify({ 
                type: 'error', 
                message: error.message, 
                timestamp: Date.now() 
              })}\n\n`);
            });
          }
        } catch (error) {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: error instanceof Error ? error.message : 'Unknown error', 
            timestamp: Date.now() 
          })}\n\n`);
        }
      }, 1000);

      // Cleanup on client disconnect
      req.on('close', () => {
        if (watchInterval) {
          clearInterval(watchInterval);
          watchInterval = null;
        }
      });

      // Keep connection alive
      const heartbeat = setInterval(() => {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeat);
      });

    } catch (error) {
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Failed to start log streaming', 
        timestamp: Date.now() 
      })}\n\n`);
    }
  });

  // Error handling middleware
  router.use((error: Error, _req: Request, res: Response, _next: () => void) => {
    console.error('[API] Unhandled error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: Date.now(),
    });
  });

  return router;
}

export default createApiRoutes;
