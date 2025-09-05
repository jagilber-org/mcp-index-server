/**
 * Phase 4: Advanced Real-time Features & Production Optimization
 * Enhanced integration with real-time streaming, advanced analytics, and production features
 */

import { SecurityMonitor } from '../security/SecurityMonitor.js';
import { DataExporter } from '../export/DataExporter.js';
import { APIIntegration } from '../integration/APIIntegration.js';
import { Phase4DashboardClient } from './Phase4DashboardClient.js';

export interface Phase4Config {
  // Enhanced Security & Monitoring
  security: {
    enableThreatDetection: boolean;
    enablePerformanceMonitoring: boolean;
    enableRealTimeAlerts: boolean;
    alertThresholds: {
      failureRate: number;
      responseTime: number;
      requestRate: number;
      errorRate: number;
      memoryUsage: number;
      cpuUsage: number;
    };
  };
  // Advanced Export & Reporting
  export: {
    enableScheduledReports: boolean;
    enableRealTimeExport: boolean;
    maxExportJobs: number;
    retentionDays: number;
    formats: string[];
    compression: boolean;
  };
  // Enhanced API Integration
  api: {
    enableHealthChecks: boolean;
    enableWebhooks: boolean;
    enableRealTimeStreaming: boolean;
    rateLimits: {
      requests: number;
      windowMs: number;
    };
    websocket: {
      pingInterval: number;
      maxConnections: number;
    };
  };
  // Advanced Dashboard Features
  dashboard: {
    updateInterval: number;
    enableRealTimeUpdates: boolean;
    enableAdvancedAnalytics: boolean;
    enableInteractiveCharts: boolean;
    maxDisplayItems: number;
    animationDuration: number;
  };
  // Phase 4: Real-time Streaming Configuration
  realtime: {
    streamingEnabled: boolean;
    streamingInterval: number;
    bufferSize: number;
    compressionEnabled: boolean;
  };
  // Phase 4: Advanced Analytics
  analytics: {
    enableHeatmaps: boolean;
    enablePredictiveAnalytics: boolean;
    historicalDataRetention: number;
    aggregationIntervals: string[];
  };
}

export class Phase4Integration {
  private securityMonitor: SecurityMonitor;
  private dataExporter: DataExporter;
  private apiIntegration: APIIntegration;
  private dashboardClient: Phase4DashboardClient;
  private config: Phase4Config;
  private initialized = false;

  constructor(container: HTMLElement, config: Partial<Phase4Config> = {}) {
    this.config = this.mergeWithDefaults(config);
    
    // Initialize components
    this.securityMonitor = new SecurityMonitor();
    this.dataExporter = new DataExporter();
    this.apiIntegration = new APIIntegration();
    this.dashboardClient = new Phase4DashboardClient(
      container,
      this.securityMonitor,
      this.dataExporter,
      this.apiIntegration
    );
  }

  /**
   * Initialize Phase 4 integration
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize dashboard client
      this.dashboardClient.initialize();

      // Setup cross-component integration
      this.setupIntegration();

      this.initialized = true;
      console.log('Phase 4 Integration initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Phase 4 Integration:', error);
      throw error;
    }
  }

  /**
   * Setup integration between components
   */
  private setupIntegration(): void {
    // Dashboard real-time updates
    if (this.config.dashboard.enableRealTimeUpdates) {
      setInterval(() => {
        this.dashboardClient.updateRealTimeData();
      }, this.config.dashboard.updateInterval);
    }
  }

  /**
   * Merge user config with defaults
   */
  private mergeWithDefaults(config: Partial<Phase4Config>): Phase4Config {
    const defaults: Phase4Config = {
      security: {
        enableThreatDetection: true,
        enablePerformanceMonitoring: true,
        enableRealTimeAlerts: true,
        alertThresholds: {
          failureRate: 0.05, // 5%
          responseTime: 5000, // 5 seconds
          requestRate: 100, // requests per minute
          errorRate: 0.03, // 3%
          memoryUsage: 85, // 85%
          cpuUsage: 80 // 80%
        }
      },
      export: {
        enableScheduledReports: true,
        enableRealTimeExport: true,
        maxExportJobs: 50,
        retentionDays: 30,
        formats: ['csv', 'json', 'excel', 'pdf'],
        compression: true
      },
      api: {
        enableHealthChecks: true,
        enableWebhooks: true,
        enableRealTimeStreaming: true,
        rateLimits: {
          requests: 1000,
          windowMs: 60000 // 1 minute
        },
        websocket: {
          pingInterval: 30000, // 30 seconds
          maxConnections: 100
        }
      },
      dashboard: {
        updateInterval: 2000, // 2 seconds
        enableRealTimeUpdates: true,
        enableAdvancedAnalytics: true,
        enableInteractiveCharts: true,
        maxDisplayItems: 100,
        animationDuration: 300 // milliseconds
      },
      realtime: {
        streamingEnabled: true,
        streamingInterval: 1000, // 1 second
        bufferSize: 1000,
        compressionEnabled: true
      },
      analytics: {
        enableHeatmaps: true,
        enablePredictiveAnalytics: true,
        historicalDataRetention: 7, // days
        aggregationIntervals: ['1m', '5m', '15m', '1h', '6h', '24h']
      }
    };

    return {
      security: { ...defaults.security, ...config.security },
      export: { ...defaults.export, ...config.export },
      api: { ...defaults.api, ...config.api },
      dashboard: { ...defaults.dashboard, ...config.dashboard },
      realtime: { ...defaults.realtime, ...config.realtime },
      analytics: { ...defaults.analytics, ...config.analytics }
    };
  }

  /**
   * Get security monitor instance
   */
  getSecurityMonitor(): SecurityMonitor {
    return this.securityMonitor;
  }

  /**
   * Get data exporter instance
   */
  getDataExporter(): DataExporter {
    return this.dataExporter;
  }

  /**
   * Get API integration instance
   */
  getAPIIntegration(): APIIntegration {
    return this.apiIntegration;
  }

  /**
   * Get dashboard client instance
   */
  getDashboardClient(): Phase4DashboardClient {
    return this.dashboardClient;
  }

  /**
   * Get current configuration
   */
  getConfig(): Phase4Config {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<Phase4Config>): void {
    this.config = this.mergeWithDefaults(newConfig);
  }

  /**
   * Get system health status
   */
  async getHealthStatus(): Promise<{
    security: { status: string; threats: number };
    export: { status: string; activeJobs: number };
    api: { status: string; endpoints: number };
    dashboard: { status: string; lastUpdate: string };
  }> {
    return {
      security: {
        status: 'healthy',
        threats: this.securityMonitor.getActiveThreats().length
      },
      export: {
        status: 'healthy',
        activeJobs: this.dataExporter.getActiveJobs().length
      },
      api: {
        status: 'healthy',
        endpoints: this.apiIntegration.getConfiguredEndpoints().length
      },
      dashboard: {
        status: 'connected',
        lastUpdate: new Date().toISOString()
      }
    };
  }

  /**
   * Shutdown all components
   */
  async shutdown(): Promise<void> {
    try {
      this.dashboardClient.destroy();
      this.initialized = false;
      console.log('Phase 4 Integration shutdown complete');
    } catch (error) {
      console.error('Error during Phase 4 Integration shutdown:', error);
      throw error;
    }
  }
}

/**
 * Initialize Phase 4 with default configuration
 */
export async function initializePhase4(container: HTMLElement, config?: Partial<Phase4Config>): Promise<Phase4Integration> {
  const integration = new Phase4Integration(container, config);
  await integration.initialize();
  return integration;
}

/**
 * Global Phase 4 instance for module access
 */
export let phase4Instance: Phase4Integration | null = null;

/**
 * Initialize and set global Phase 4 instance
 */
export async function setupPhase4Global(container: HTMLElement, config?: Partial<Phase4Config>): Promise<void> {
  if (phase4Instance) {
    await phase4Instance.shutdown();
  }
  
  phase4Instance = await initializePhase4(container, config);
  
  // Add to window for debugging
  if (typeof window !== 'undefined') {
    (window as unknown as { phase4: Phase4Integration }).phase4 = phase4Instance;
  }
}
