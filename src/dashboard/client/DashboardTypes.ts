/**
 * DashboardTypes - Type definitions for Phase 2 Dashboard Client
 * 
 * Comprehensive type definitions for Chart.js integration,
 * WebSocket messages, and dashboard components
 */

// Chart.js type definitions for dashboard
export interface ChartJsChart {
  data: {
    labels: string[];
    datasets: ChartDataset[];
  };
  update: (mode?: string) => void;
  destroy: () => void;
}

export interface ChartDataset {
  label?: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string;
  borderWidth?: number;
  fill?: boolean;
  tension?: number;
}

export interface ChartConfiguration {
  type: 'line' | 'bar' | 'doughnut' | 'pie';
  data: {
    labels: string[];
    datasets: ChartDataset[];
  };
  options: ChartOptions;
}

export interface ChartOptions {
  responsive: boolean;
  maintainAspectRatio: boolean;
  plugins?: {
    legend?: {
      display?: boolean;
      position?: 'top' | 'bottom' | 'left' | 'right';
      labels?: {
        boxWidth?: number;
        padding?: number;
      };
    };
  };
  scales?: {
    x?: AxisOptions;
    y?: AxisOptions;
  };
}

export interface AxisOptions {
  display: boolean;
  title?: {
    display: boolean;
    text: string;
  };
  beginAtZero?: boolean;
  max?: number;
}

// WebSocket message types
export interface WebSocketMessage {
  type: 'metrics' | 'toolCall' | 'connectionUpdate' | 'alert' | 'requestMetrics';
  payload?: unknown;
}

export interface MetricsMessage extends WebSocketMessage {
  type: 'metrics';
  payload: MetricsSnapshot;
}

export interface ToolCallMessage extends WebSocketMessage {
  type: 'toolCall';
  payload: ToolCallPayload;
}

export interface ConnectionUpdateMessage extends WebSocketMessage {
  type: 'connectionUpdate';
  payload: ConnectionPayload;
}

export interface AlertMessage extends WebSocketMessage {
  type: 'alert';
  payload: AlertPayload;
}

export interface RequestMetricsMessage extends WebSocketMessage {
  type: 'requestMetrics';
  payload?: never;
}

// Payload types
export interface ToolCallPayload {
  toolName: string;
  timestamp: number;
  duration: number;
  success: boolean;
}

export interface ConnectionPayload {
  connectionId: string;
  action: 'connected' | 'disconnected';
  timestamp: number;
}

export interface AlertPayload {
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
}

// Dashboard data types
export interface MetricsSnapshot {
  timestamp: number;
  server: {
    uptime: number;
    version: string;
    nodeVersion: string;
    totalRequests: number;
  };
  tools: { [toolName: string]: ToolMetrics };
  connections: {
    totalConnections: number;
    disconnectedConnections: number;
    avgSessionDuration: number;
  };
  performance: {
    requestsPerMinute: number;
    successRate: number;
    avgResponseTime: number;
    errorRate: number;
  };
}

export interface ToolMetrics {
  callCount: number;
  successCount: number;
  errorCount: number;
  avgResponseTime: number;
  lastCalled?: number;
}

// Window interface extensions for Chart.js and dashboard
declare global {
  interface Window {
    Chart: {
      new (ctx: CanvasRenderingContext2D, config: ChartConfiguration): ChartJsChart;
    };
    DASHBOARD_WS_URL: string;
    dashboardClient: import('./DashboardClient').DashboardClient;
  }
}

// Notification types
export type NotificationLevel = 'info' | 'warning' | 'error' | 'success';

export interface DashboardExportData {
  timestamp: number;
  metricsHistory: MetricsSnapshot[];
  isConnected: boolean;
}

// Chart data preparation types
export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface LineChartData extends ChartData {
  datasets: Array<ChartDataset & {
    borderColor: string;
    backgroundColor: string;
    borderWidth: number;
    fill: boolean;
    tension: number;
  }>;
}

export interface DoughnutChartData extends ChartData {
  datasets: Array<ChartDataset & {
    backgroundColor: string[];
    borderWidth: number;
  }>;
}

export interface BarChartData extends ChartData {
  datasets: Array<ChartDataset & {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
  }>;
}
