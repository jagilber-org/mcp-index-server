/**
 * DashboardClient - Phase 2 Advanced Dashboard Features
 * 
 * Client-side TypeScript for enhanced dashboard functionality including:
 * - Real-time WebSocket updates
 * - Interactive charts and visualizations
 * - Advanced filtering and search
 * - Performance monitoring and alerts
 */

import {
  MetricsSnapshot,
  ToolMetrics,
  ChartJsChart,
  WebSocketMessage,
  MetricsMessage,
  ToolCallMessage,
  ConnectionUpdateMessage,
  AlertMessage,
  ToolCallPayload,
  ConnectionPayload,
  AlertPayload,
  NotificationLevel,
  DashboardExportData
} from './DashboardTypes';

export class DashboardClient {
  private ws: WebSocket | null = null;
  private charts: Map<string, ChartJsChart> = new Map();
  private metricsHistory: MetricsSnapshot[] = [];
  private maxHistoryLength = 100;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(private wsUrl: string) {
    this.initializeWebSocket();
    this.initializeCharts();
    this.setupEventListeners();
  }

  /**
   * Initialize WebSocket connection for real-time updates
   */
  private initializeWebSocket(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.onopen = () => {
        console.log('[Dashboard] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateConnectionStatus(true);
        
        // Request initial metrics
        this.sendMessage({ type: 'requestMetrics' });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('[Dashboard] Error parsing WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[Dashboard] WebSocket disconnected');
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[Dashboard] WebSocket error:', error);
      };
    } catch (error) {
      console.error('[Dashboard] Failed to initialize WebSocket:', error);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: WebSocketMessage): void {
    switch (data.type) {
      case 'metrics':
        this.updateMetrics((data as MetricsMessage).payload);
        break;
      case 'toolCall':
        this.handleToolCallUpdate((data as ToolCallMessage).payload);
        break;
      case 'connectionUpdate':
        this.handleConnectionUpdate((data as ConnectionUpdateMessage).payload);
        break;
      case 'alert':
        this.showAlert((data as AlertMessage).payload);
        break;
      default:
        console.log('[Dashboard] Unknown message type:', data.type);
    }
  }

  /**
   * Update dashboard with new metrics data
   */
  private updateMetrics(snapshot: MetricsSnapshot): void {
    // Add to history
    this.metricsHistory.push(snapshot);
    if (this.metricsHistory.length > this.maxHistoryLength) {
      this.metricsHistory.shift();
    }

    // Update all dashboard components
    this.updateStatusCards(snapshot);
    this.updateCharts(snapshot);
    this.updateToolsList(snapshot.tools);
    this.updatePerformanceMetrics(snapshot.performance);
  }

  /**
   * Initialize interactive charts using Chart.js
   */
  private initializeCharts(): void {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.createCharts());
    } else {
      this.createCharts();
    }
  }

  /**
   * Create Chart.js charts for dashboard visualization
   */
  private createCharts(): void {
    // Requests per minute chart
    this.createRequestsChart();
    
    // Tool usage distribution chart
    this.createToolUsageChart();
    
    // Response time trends chart
    this.createResponseTimeChart();
    
    // Error rate chart
    this.createErrorRateChart();
  }

  /**
   * Create requests per minute line chart
   */
  private createRequestsChart(): void {
    const canvas = document.getElementById('requestsChart') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Requests per Minute',
          data: [],
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Requests/min'
            },
            beginAtZero: true
          }
        }
      }
    });

    this.charts.set('requests', chart);
  }

  /**
   * Create tool usage pie/doughnut chart
   */
  private createToolUsageChart(): void {
    const canvas = document.getElementById('toolUsageChart') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chart = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [
            '#3498db', '#e74c3c', '#f39c12', '#27ae60', '#9b59b6',
            '#1abc9c', '#34495e', '#f1c40f', '#e67e22', '#95a5a6'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              padding: 15
            }
          }
        }
      }
    });

    this.charts.set('toolUsage', chart);
  }

  /**
   * Create response time trends chart
   */
  private createResponseTimeChart(): void {
    const canvas = document.getElementById('responseTimeChart') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Avg Response Time (ms)',
          data: [],
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Response Time (ms)'
            },
            beginAtZero: true
          }
        }
      }
    });

    this.charts.set('responseTime', chart);
  }

  /**
   * Create error rate chart
   */
  private createErrorRateChart(): void {
    const canvas = document.getElementById('errorRateChart') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Error Rate (%)',
          data: [],
          backgroundColor: '#e74c3c',
          borderColor: '#c0392b',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Error Rate (%)'
            },
            beginAtZero: true,
            max: 100
          }
        }
      }
    });

    this.charts.set('errorRate', chart);
  }

  /**
   * Update charts with new data
   */
  private updateCharts(snapshot: MetricsSnapshot): void {
    const timeLabel = new Date(snapshot.timestamp).toLocaleTimeString();

    // Update requests chart
    this.updateLineChart('requests', timeLabel, snapshot.performance.requestsPerMinute);

    // Update tool usage chart
    this.updateToolUsageChartData(snapshot.tools);

    // Update response time chart
    this.updateLineChart('responseTime', timeLabel, snapshot.performance.avgResponseTime);

    // Update error rate chart
    this.updateBarChart('errorRate', timeLabel, snapshot.performance.errorRate * 100);
  }

  /**
   * Update line chart with new data point
   */
  private updateLineChart(chartKey: string, label: string, value: number): void {
    const chart = this.charts.get(chartKey);
    if (!chart) return;

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);

    // Keep only last 20 data points
    if (chart.data.labels.length > 20) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }

    chart.update('none');
  }

  /**
   * Update bar chart with new data point
   */
  private updateBarChart(chartKey: string, label: string, value: number): void {
    const chart = this.charts.get(chartKey);
    if (!chart) return;

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);

    // Keep only last 10 data points for bar chart
    if (chart.data.labels.length > 10) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }

    chart.update('none');
  }

  /**
   * Update tool usage chart data
   */
  private updateToolUsageChartData(tools: { [toolName: string]: ToolMetrics }): void {
    const chart = this.charts.get('toolUsage');
    if (!chart) return;

    const toolNames = Object.keys(tools);
    const callCounts = toolNames.map(name => tools[name].callCount);

    chart.data.labels = toolNames;
    chart.data.datasets[0].data = callCounts;
    chart.update('none');
  }

  /**
   * Update status cards with current metrics
   */
  private updateStatusCards(snapshot: MetricsSnapshot): void {
    this.updateElement('uptime-value', this.formatUptime(snapshot.server.uptime));
    this.updateElement('total-requests-value', snapshot.server.totalRequests.toLocaleString());
    this.updateElement('success-rate-value', `${(snapshot.performance.successRate * 100).toFixed(1)}%`);
    this.updateElement('avg-response-time-value', `${snapshot.performance.avgResponseTime.toFixed(0)}ms`);
    this.updateElement('connections-value', snapshot.connections.totalConnections.toString());
  }

  /**
   * Update tools list table
   */
  private updateToolsList(tools: { [toolName: string]: ToolMetrics }): void {
    const tbody = document.getElementById('tools-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    Object.entries(tools).forEach(([toolName, metrics]) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="tool-name">${toolName}</td>
        <td class="tool-calls">${metrics.callCount}</td>
        <td class="tool-success">${metrics.successCount}</td>
        <td class="tool-errors">${metrics.errorCount}</td>
        <td class="tool-response-time">${metrics.avgResponseTime.toFixed(0)}ms</td>
        <td class="tool-last-called">${metrics.lastCalled ? new Date(metrics.lastCalled).toLocaleTimeString() : 'Never'}</td>
      `;
      tbody.appendChild(row);
    });
  }

  /**
   * Update performance metrics section
   */
  private updatePerformanceMetrics(performance: MetricsSnapshot['performance']): void {
    const requestsElement = document.getElementById('requests-per-minute');
    if (requestsElement) {
      requestsElement.textContent = performance.requestsPerMinute.toFixed(1);
    }

    const errorRateElement = document.getElementById('error-rate-percent');
    if (errorRateElement) {
      errorRateElement.textContent = `${(performance.errorRate * 100).toFixed(2)}%`;
      
      // Update color based on error rate
      const container = errorRateElement.closest('.metric-item');
      if (container) {
        container.className = 'metric-item';
        if (performance.errorRate > 0.05) {
          container.classList.add('metric-danger');
        } else if (performance.errorRate > 0.01) {
          container.classList.add('metric-warning');
        } else {
          container.classList.add('metric-success');
        }
      }
    }
  }

  /**
   * Handle tool call updates
   */
  private handleToolCallUpdate(payload: ToolCallPayload): void {
    // Show recent tool call notification
    this.showNotification(`Tool called: ${payload.toolName}`, 'info');
  }

  /**
   * Handle connection updates
   */
  private handleConnectionUpdate(payload: ConnectionPayload): void {
    // Update connection status
    console.log('[Dashboard] Connection update:', payload);
  }

  /**
   * Show alert notification
   */
  private showAlert(payload: AlertPayload): void {
    this.showNotification(payload.message, payload.level || 'warning');
  }

  /**
   * Show notification to user
   */
  private showNotification(message: string, level: NotificationLevel = 'info'): void {
    const notification = document.createElement('div');
    notification.className = `notification notification-${level}`;
    notification.textContent = message;

    const container = document.getElementById('notifications-container') || document.body;
    container.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }

  /**
   * Setup event listeners for dashboard interactions
   */
  private setupEventListeners(): void {
    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.sendMessage({ type: 'requestMetrics' });
      });
    }

    // WebSocket reconnect button
    const reconnectBtn = document.getElementById('reconnect-btn');
    if (reconnectBtn) {
      reconnectBtn.addEventListener('click', () => {
        this.initializeWebSocket();
      });
    }

    // Tools filter input
    const filterInput = document.getElementById('tools-filter') as HTMLInputElement;
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        this.filterToolsTable((e.target as HTMLInputElement).value);
      });
    }
  }

  /**
   * Filter tools table based on search input
   */
  private filterToolsTable(searchTerm: string): void {
    const tbody = document.getElementById('tools-table-body');
    if (!tbody) return;

    const rows = tbody.getElementsByTagName('tr');
    const term = searchTerm.toLowerCase();

    Array.from(rows).forEach(row => {
      const toolName = row.querySelector('.tool-name')?.textContent?.toLowerCase() || '';
      row.style.display = toolName.includes(term) ? '' : 'none';
    });
  }

  /**
   * Update connection status indicator
   */
  private updateConnectionStatus(connected: boolean): void {
    const indicator = document.getElementById('connection-status');
    if (indicator) {
      indicator.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
      indicator.textContent = connected ? 'Connected' : 'Disconnected';
    }
  }

  /**
   * Attempt to reconnect WebSocket
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Dashboard] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Dashboard] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.initializeWebSocket();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Send message via WebSocket
   */
  private sendMessage(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Utility function to update element content
   */
  private updateElement(id: string, content: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = content;
    }
  }

  /**
   * Format uptime in human-readable format
   */
  private formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get metrics history for analysis
   */
  public getMetricsHistory(): MetricsSnapshot[] {
    return [...this.metricsHistory];
  }

  /**
   * Export dashboard data
   */
  public exportData(): string {
    const exportData: DashboardExportData = {
      timestamp: Date.now(),
      metricsHistory: this.metricsHistory,
      isConnected: this.isConnected
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Cleanup and disconnect
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Cleanup charts
    this.charts.forEach(chart => {
      if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
      }
    });
    this.charts.clear();
  }
}

// Global dashboard instance
let dashboardClient: DashboardClient | null = null;

// Initialize dashboard when DOM is ready
function initializeDashboard(): void {
  const wsUrl = window.DASHBOARD_WS_URL;
  if (wsUrl) {
    dashboardClient = new DashboardClient(wsUrl);
    window.dashboardClient = dashboardClient;
  }
}

// Auto-initialize if we're in a browser environment
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
  } else {
    initializeDashboard();
  }
}

export { initializeDashboard, dashboardClient };
