/**
 * ApiRoutes - Phase 1 Dashboard Foundation
 * 
 * Express.js routes for dashboard REST API endpoints.
 * Provides endpoints for metrics, tools, and server status.
 */

import express, { Router, Request, Response } from 'express';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector.js';
import { listRegisteredMethods } from '../../server/registry.js';
import { getAdminPanel } from './AdminPanel.js';

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

  /**
   * GET /api/status - Server status and basic info
   */
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      
      res.json({
        status: 'online',
        version: snapshot.server.version,
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
      
      // Simple health indicators
      const isHealthy = {
        uptime: snapshot.server.uptime > 1000, // At least 1 second uptime
        memory: memUsage.heapUsed < memUsage.heapTotal * 0.9, // Less than 90% heap usage
        errors: snapshot.performance.errorRate < 10, // Less than 10% error rate
      };

      const overallHealth = Object.values(isHealthy).every(Boolean);

      res.status(overallHealth ? 200 : 503).json({
        status: overallHealth ? 'healthy' : 'degraded',
        checks: isHealthy,
        uptime: snapshot.server.uptime,
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
