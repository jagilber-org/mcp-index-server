/**
 * ApiRoutes - Phase 1 Dashboard Foundation
 * 
 * Express.js routes for dashboard REST API endpoints.
 * Provides endpoints for metrics, tools, and server status.
 */

import express, { Router, Request, Response } from 'express';
import { getWebSocketManager } from './WebSocketManager.js';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector.js';
import { listRegisteredMethods, getHandler } from '../../server/registry.js';
import { getAdminPanel } from './AdminPanel.js';
import fs from 'fs';
import path from 'path';

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
    const enableHttpMetrics = process.env.MCP_HTTP_METRICS !== '0';
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
      // Thresholds (configurable via env vars for tuning)
      const memoryThreshold = parseFloat(process.env.MCP_HEALTH_MEMORY_THRESHOLD || '0.95'); // ratio
      const errorRateThreshold = parseFloat(process.env.MCP_HEALTH_ERROR_THRESHOLD || '10'); // percent
      const minUptimeMs = parseInt(process.env.MCP_HEALTH_MIN_UPTIME || '1000', 10);

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
      res.json({
        success: true,
        config,
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

  /**
   * POST /api/admin/config - Update admin configuration
   */
  router.post('/admin/config', (req: Request, res: Response) => {
    try {
      const updates = req.body;
      const result = adminPanel.updateAdminConfig(updates);
      
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
  const instructionsDir = process.env.MCP_INSTRUCTIONS_DIR || path.join(process.cwd(), 'instructions');

  function ensureInstructionsDir() {
    try {
      if (!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  /**
   * GET /api/instructions - list instruction JSON files
   */
  router.get('/instructions', (_req: Request, res: Response) => {
    try {
      ensureInstructionsDir();
      const classify = (basename: string): { category: string; sizeCategory: string } => {
        const lower = basename.toLowerCase();
        let category = 'general';
        if (lower.startsWith('alpha')) category = 'alpha';
        else if (lower.startsWith('beta')) category = 'beta';
        else if (lower.includes('seed')) category = 'seed';
        else if (lower.includes('enterprise')) category = 'enterprise';
        else if (lower.includes('dispatcher')) category = 'dispatcher';
        // size buckets decided after stat
        return { category, sizeCategory: 'small' };
      };
      const files = fs.readdirSync(instructionsDir)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => {
          const stat = fs.statSync(path.join(instructionsDir, f));
            const base = f.replace(/\.json$/i, '');
            const meta = classify(base);
            const sizeCategory = stat.size < 1024 ? 'small' : (stat.size < 5 * 1024 ? 'medium' : 'large');
            return { name: base, size: stat.size, mtime: stat.mtimeMs, category: meta.category, sizeCategory };
        });
      res.json({ success: true, instructions: files, count: files.length, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to list instructions', message: error instanceof Error? error.message:'Unknown error' });
    }
  });

  /**
   * GET /api/instructions/:name - get single instruction content
   */
  router.get('/instructions/:name', (req: Request, res: Response) => {
    try {
      ensureInstructionsDir();
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
      ensureInstructionsDir();
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
      ensureInstructionsDir();
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
      ensureInstructionsDir();
      const file = path.join(instructionsDir, req.params.name + '.json');
      if (!fs.existsSync(file)) return res.status(404).json({ success:false, error:'Not found' });
      fs.unlinkSync(file);
      res.json({ success:true, message:'Instruction deleted', timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success:false, error:'Failed to delete instruction', message: error instanceof Error? error.message:'Unknown error' });
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
