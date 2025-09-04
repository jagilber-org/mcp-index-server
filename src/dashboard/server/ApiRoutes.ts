/**
 * ApiRoutes - Phase 1 Dashboard Foundation
 * 
 * Express.js routes for dashboard REST API endpoints.
 * Provides endpoints for metrics, tools, and server status.
 */

import express, { Router, Request, Response } from 'express';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector.js';
import { listRegisteredMethods } from '../../server/registry.js';

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
