/**
 * Phase 3 Enhanced Dashboard Client with Business Intelligence
 * 
 * Advanced dashboard client featuring:
 * - Executive and operational dashboard views
 * - Real-time business intelligence widgets
 * - Interactive charts with drill-down capabilities
 * - Advanced filtering and customization
 * - Responsive design with multiple themes
 */

import { getBusinessIntelligence, DashboardLayout, KPIWidget, ChartConfiguration } from '../analytics/BusinessIntelligence.js';

// Chart.js type definitions
interface ChartDataPoint {
  x: number | string;
  y: number;
}

declare global {
  class Chart {
    constructor(ctx: CanvasRenderingContext2D, config: {
      type: string;
      data: Record<string, unknown>;
      options: Record<string, unknown>;
    });
    data: Record<string, unknown>;
    update: (mode?: string) => void;
    destroy: () => void;
    resize: () => void;
  }
}

interface SectionConfig {
  id: string;
  title: string;
  type: 'kpi' | 'chart' | 'table' | 'alert' | 'text' | 'custom';
  position: { row: number; col: number; width: number; height: number };
  config: KPIWidget | ChartConfiguration | TableConfig | AlertConfig;
  visible: boolean;
  minimized: boolean;
}

interface TableConfig {
  id: string;
  title: string;
  columns: TableColumn[];
  data: Record<string, unknown>[];
  pagination: {
    enabled: boolean;
    pageSize: number;
    currentPage: number;
  };
  search: {
    enabled: boolean;
    placeholder: string;
  };
}

interface AlertConfig {
  id: string;
  title: string;
  alerts: AlertItem[];
  maxVisible: number;
  autoRefresh: boolean;
}

interface AlertItem {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  timestamp: number;
  acknowledged: boolean;
  actionUrl?: string;
}

interface TableColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'badge' | 'progress';
  sortable: boolean;
  filterable: boolean;
}

interface RealTimeUpdateData {
  kpis?: KPIWidget[];
  charts?: ChartConfiguration[];
  timestamp: number;
}

interface DashboardState {
  currentDashboard: string;
  layout: DashboardLayout | null;
  theme: 'light' | 'dark' | 'auto';
  isRealTimeEnabled: boolean;
  subscriptionId: string | null;
  chartInstances: Map<string, Chart>;
  refreshInterval: number;
  customFilters: Record<string, unknown>;
}

class Phase3DashboardClient {
  private state: DashboardState;
  private businessIntelligence = getBusinessIntelligence();
  private socket: WebSocket | null = null;
  private chartInstances: Map<string, Chart> = new Map();
  private resizeObserver: ResizeObserver | null = null;
  
  constructor() {
    this.state = {
      currentDashboard: 'executive',
      layout: null,
      theme: 'auto',
      isRealTimeEnabled: true,
      subscriptionId: null,
      chartInstances: new Map(),
      refreshInterval: 30000,
      customFilters: {}
    };
    
    this.initializeDashboard();
    this.setupWebSocketConnection();
    this.setupEventListeners();
    this.setupResizeObserver();
  }
  
  /**
   * Initialize the dashboard with default layout
   */
  private initializeDashboard(): void {
    this.loadDashboard(this.state.currentDashboard);
    this.applyTheme();
    this.setupRealTimeUpdates();
  }
  
  /**
   * Load a specific dashboard layout
   */
  loadDashboard(dashboardName: string): void {
    console.log(`Loading dashboard: ${dashboardName}`);
    
    const layout = this.businessIntelligence.getDashboardLayout(dashboardName);
    if (!layout) {
      console.error(`Dashboard layout not found: ${dashboardName}`);
      return;
    }
    
    this.state.currentDashboard = dashboardName;
    this.state.layout = layout;
    this.state.refreshInterval = layout.refreshInterval;
    
    this.renderDashboard();
    this.setupRealTimeUpdates();
  }
  
  /**
   * Render the complete dashboard
   */
  private renderDashboard(): void {
    if (!this.state.layout) return;
    
    const container = document.getElementById('dashboard-container');
    if (!container) {
      console.error('Dashboard container not found');
      return;
    }
    
    // Clear existing content
    container.innerHTML = '';
    
    // Create dashboard header
    const header = this.createDashboardHeader();
    container.appendChild(header);
    
    // Create dashboard grid
    const grid = this.createDashboardGrid();
    container.appendChild(grid);
    
    // Render sections
    this.state.layout.sections.forEach(section => {
      if (section.visible) {
        this.renderSection(section, grid);
      }
    });
    
    // Initialize charts after DOM is ready
    setTimeout(() => this.initializeCharts(), 100);
  }
  
  /**
   * Create dashboard header with controls
   */
  private createDashboardHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'dashboard-header';
    header.innerHTML = `
      <div class="dashboard-title">
        <h1>${this.getDashboardTitle()}</h1>
        <span class="last-updated">Last updated: ${new Date().toLocaleTimeString()}</span>
      </div>
      
      <div class="dashboard-controls">
        <div class="dashboard-selector">
          <label for="dashboard-select">Dashboard:</label>
          <select id="dashboard-select" value="${this.state.currentDashboard}">
            <option value="executive">Executive</option>
            <option value="operational">Operational</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        
        <div class="theme-selector">
          <label for="theme-select">Theme:</label>
          <select id="theme-select" value="${this.state.theme}">
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        
        <div class="realtime-toggle">
          <label>
            <input type="checkbox" id="realtime-checkbox" ${this.state.isRealTimeEnabled ? 'checked' : ''}>
            Real-time Updates
          </label>
        </div>
        
        <button id="refresh-dashboard" class="btn btn-primary">
          <i class="icon-refresh"></i> Refresh
        </button>
        
        <button id="export-dashboard" class="btn btn-secondary">
          <i class="icon-download"></i> Export
        </button>
      </div>
    `;
    
    return header;
  }
  
  /**
   * Create dashboard grid container
   */
  private createDashboardGrid(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'dashboard-grid';
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(${this.state.layout?.columns || 6}, 1fr);
      gap: 20px;
      padding: 20px;
      min-height: calc(100vh - 120px);
    `;
    
    return grid;
  }
  
  /**
   * Render individual dashboard section
   */
  private renderSection(section: SectionConfig, container: HTMLElement): void {
    const sectionElement = document.createElement('div');
    sectionElement.className = `dashboard-section section-${section.type}`;
    sectionElement.id = section.id;
    sectionElement.style.cssText = `
      grid-column: span ${section.position.width};
      grid-row: span ${section.position.height};
      background: var(--section-bg);
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: all 0.3s ease;
    `;
    
    // Add section header
    const header = document.createElement('div');
    header.className = 'section-header';
    header.innerHTML = `
      <h3>${section.title}</h3>
      <div class="section-controls">
        <button class="section-minimize" title="Minimize">
          <i class="icon-minus"></i>
        </button>
        <button class="section-settings" title="Settings">
          <i class="icon-settings"></i>
        </button>
      </div>
    `;
    
    sectionElement.appendChild(header);
    
    // Add section content based on type
    const content = this.createSectionContent(section);
    sectionElement.appendChild(content);
    
    container.appendChild(sectionElement);
  }
  
  /**
   * Create content for different section types
   */
  private createSectionContent(section: SectionConfig): HTMLElement {
    const content = document.createElement('div');
    content.className = 'section-content';
    
    switch (section.type) {
      case 'kpi':
        content.appendChild(this.createKPIWidget(section.config as KPIWidget));
        break;
      case 'chart':
        content.appendChild(this.createChartWidget(section.config as ChartConfiguration));
        break;
      case 'table':
        content.appendChild(this.createTableWidget(section.config as TableConfig));
        break;
      case 'alert':
        content.appendChild(this.createAlertWidget(section.config as AlertConfig));
        break;
      default:
        content.innerHTML = '<div class="placeholder">Unsupported section type</div>';
    }
    
    return content;
  }
  
  /**
   * Create KPI widget
   */
  private createKPIWidget(config: KPIWidget): HTMLElement {
    const widget = document.createElement('div');
    widget.className = `kpi-widget kpi-${config.color}`;
    widget.innerHTML = `
      <div class="kpi-content">
        <div class="kpi-icon">
          <i class="icon-${config.icon}"></i>
        </div>
        <div class="kpi-info">
          <div class="kpi-value">${config.value}</div>
          <div class="kpi-title">${config.title}</div>
        </div>
        <div class="kpi-trend trend-${config.trend}">
          <i class="icon-arrow-${config.trend}"></i>
          <span>${config.trendPercentage.toFixed(1)}%</span>
        </div>
      </div>
      ${config.description ? `<div class="kpi-description">${config.description}</div>` : ''}
    `;
    
    return widget;
  }
  
  /**
   * Create chart widget
   */
  private createChartWidget(config: ChartConfiguration): HTMLElement {
    const widget = document.createElement('div');
    widget.className = 'chart-widget';
    widget.innerHTML = `
      <div class="chart-container">
        <canvas id="chart-${config.id}" width="400" height="300"></canvas>
      </div>
      <div class="chart-legend" id="legend-${config.id}"></div>
    `;
    
    return widget;
  }
  
  /**
   * Create table widget
   */
  private createTableWidget(config: TableConfig): HTMLElement {
    const widget = document.createElement('div');
    widget.className = 'table-widget';
    
    let tableHTML = '<div class="table-container">';
    
    // Add search if enabled
    if (config.search?.enabled) {
      tableHTML += `
        <div class="table-search">
          <input type="text" placeholder="${config.search.placeholder}" id="search-${config.id}">
        </div>
      `;
    }
    
    // Create table
    tableHTML += '<table class="data-table"><thead><tr>';
    config.columns.forEach((column: TableColumn) => {
      const sortable = column.sortable ? 'sortable' : '';
      tableHTML += `<th class="${sortable}" data-column="${column.key}">${column.label}</th>`;
    });
    tableHTML += '</tr></thead><tbody>';
    
    // Add data rows
    config.data.forEach((row: Record<string, unknown>) => {
      tableHTML += '<tr>';
      config.columns.forEach((column: TableColumn) => {
        const value = row[column.key];
        let cellContent = value;
        
        if (column.type === 'badge') {
          cellContent = `<span class="badge badge-${value}">${value}</span>`;
        } else if (column.type === 'progress') {
          cellContent = `<div class="progress"><div class="progress-bar" style="width: ${value}%">${value}%</div></div>`;
        }
        
        tableHTML += `<td>${cellContent}</td>`;
      });
      tableHTML += '</tr>';
    });
    
    tableHTML += '</tbody></table></div>';
    
    // Add pagination if enabled
    if (config.pagination?.enabled) {
      tableHTML += `
        <div class="table-pagination">
          <button class="btn btn-sm" id="prev-${config.id}">Previous</button>
          <span class="page-info">Page ${config.pagination.currentPage} of X</span>
          <button class="btn btn-sm" id="next-${config.id}">Next</button>
        </div>
      `;
    }
    
    widget.innerHTML = tableHTML;
    return widget;
  }
  
  /**
   * Create alert widget
   */
  private createAlertWidget(config: AlertConfig): HTMLElement {
    const widget = document.createElement('div');
    widget.className = 'alert-widget';
    
    let alertsHTML = '<div class="alerts-container">';
    
    const visibleAlerts = config.alerts.slice(0, config.maxVisible);
    visibleAlerts.forEach((alert: AlertItem) => {
      const timeAgo = this.formatTimeAgo(alert.timestamp);
      const acknowledgedClass = alert.acknowledged ? 'acknowledged' : '';
      
      alertsHTML += `
        <div class="alert alert-${alert.severity} ${acknowledgedClass}" data-alert-id="${alert.id}">
          <div class="alert-content">
            <div class="alert-header">
              <i class="icon-${this.getAlertIcon(alert.severity)}"></i>
              <span class="alert-time">${timeAgo}</span>
            </div>
            <div class="alert-message">${alert.message}</div>
            ${alert.actionUrl ? `<a href="${alert.actionUrl}" class="alert-action">Take Action</a>` : ''}
          </div>
          <button class="alert-dismiss" data-alert-id="${alert.id}">
            <i class="icon-x"></i>
          </button>
        </div>
      `;
    });
    
    alertsHTML += '</div>';
    
    if (config.alerts.length > config.maxVisible) {
      alertsHTML += `
        <div class="alerts-footer">
          <button class="btn btn-sm show-all-alerts">
            Show ${config.alerts.length - config.maxVisible} more alerts
          </button>
        </div>
      `;
    }
    
    widget.innerHTML = alertsHTML;
    return widget;
  }
  
  /**
   * Initialize all charts in the dashboard
   */
  private initializeCharts(): void {
    if (!this.state.layout) return;
    
    this.state.layout.sections.forEach(section => {
      if (section.type === 'chart' && section.visible) {
        this.initializeChart(section.config as ChartConfiguration);
      }
    });
  }
  
  /**
   * Initialize individual chart
   */
  private initializeChart(config: ChartConfiguration): void {
    const canvas = document.getElementById(`chart-${config.id}`) as HTMLCanvasElement;
    if (!canvas) {
      console.error(`Chart canvas not found: chart-${config.id}`);
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Destroy existing chart if it exists
    const existingChart = this.chartInstances.get(config.id);
    if (existingChart) {
      existingChart.destroy();
    }
    
    // Create new chart
    const chart = new Chart(ctx, {
      type: config.type,
      data: {
        datasets: config.data
      },
      options: config.options as unknown as Record<string, unknown>
    });
    
    this.chartInstances.set(config.id, chart);
  }
  
  /**
   * Update chart data
   */
  private updateChart(chartId: string, newData: Record<string, unknown>): void {
    const chart = this.chartInstances.get(chartId);
    if (!chart) return;
    
    chart.data = newData;
    chart.update('active');
  }
  
  /**
   * Setup real-time updates
   */
  private setupRealTimeUpdates(): void {
    // Clear existing subscription
    if (this.state.subscriptionId) {
      this.businessIntelligence.unsubscribeFromRealTimeUpdates(this.state.subscriptionId);
    }
    
    if (!this.state.isRealTimeEnabled) return;
    
    // Subscribe to real-time updates
    this.state.subscriptionId = this.businessIntelligence.subscribeToRealTimeUpdates(
      this.state.currentDashboard,
      (data: unknown) => {
        this.handleRealTimeUpdate(data as RealTimeUpdateData);
      }
    );
  }
  
  /**
   * Handle real-time update data
   */
  private handleRealTimeUpdate(data: RealTimeUpdateData): void {
    console.log('Received real-time update:', data);
    
    // Update KPI widgets
    if (data.kpis) {
      this.updateKPIWidgets(data.kpis);
    }
    
    // Update charts
    if (data.charts) {
      data.charts.forEach((chartConfig: ChartConfiguration) => {
        this.updateChart(chartConfig.id, { datasets: chartConfig.data });
      });
    }
    
    // Update last updated timestamp
    const lastUpdated = document.querySelector('.last-updated');
    if (lastUpdated) {
      lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    }
  }
  
  /**
   * Update KPI widgets with new data
   */
  private updateKPIWidgets(kpis: KPIWidget[]): void {
    kpis.forEach(kpi => {
      const widget = document.querySelector(`[data-kpi-id="${kpi.id}"]`);
      if (widget) {
        const valueElement = widget.querySelector('.kpi-value');
        const trendElement = widget.querySelector('.kpi-trend span');
        const trendIcon = widget.querySelector('.kpi-trend i');
        
        if (valueElement) valueElement.textContent = kpi.value.toString();
        if (trendElement) trendElement.textContent = `${kpi.trendPercentage.toFixed(1)}%`;
        if (trendIcon) {
          trendIcon.className = `icon-arrow-${kpi.trend}`;
        }
        
        // Update color classes
        widget.className = `kpi-widget kpi-${kpi.color}`;
      }
    });
  }
  
  /**
   * Setup WebSocket connection for real-time data
   */
  private setupWebSocketConnection(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    this.socket = new WebSocket(wsUrl);
    
    this.socket.onopen = () => {
      console.log('WebSocket connected');
    };
    
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    this.socket.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt to reconnect after 5 seconds
      setTimeout(() => this.setupWebSocketConnection(), 5000);
    };
    
    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'metrics_update':
        this.handleRealTimeUpdate(data.payload as RealTimeUpdateData);
        break;
      case 'alert':
        this.handleNewAlert(data.payload as AlertItem);
        break;
      case 'system_status':
        this.handleSystemStatusUpdate(data.payload as Record<string, unknown>);
        break;
      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  }
  
  /**
   * Handle new alert
   */
  private handleNewAlert(alert: AlertItem): void {
    // Show toast notification for new alerts
    this.showToastNotification(alert.message, alert.severity);
    
    // Update alert widgets if visible
    const alertWidgets = document.querySelectorAll('.alert-widget');
    alertWidgets.forEach(widget => {
      // Add new alert to the top of the list
      const container = widget.querySelector('.alerts-container');
      if (container) {
        const alertElement = this.createAlertElement(alert);
        container.insertBefore(alertElement, container.firstChild);
      }
    });
  }
  
  /**
   * Handle system status update
   */
  private handleSystemStatusUpdate(status: Record<string, unknown>): void {
    // Update system status indicator
    const statusIndicator = document.querySelector('.system-status') as HTMLElement;
    if (statusIndicator) {
      statusIndicator.className = `system-status status-${status.health}`;
      statusIndicator.title = `System Health: ${status.health} - ${status.message}`;
    }
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    document.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      
      if (target.id === 'dashboard-select') {
        const select = target as HTMLSelectElement;
        this.loadDashboard(select.value);
      } else if (target.id === 'theme-select') {
        const select = target as HTMLSelectElement;
        this.state.theme = select.value as 'light' | 'dark' | 'auto';
        this.applyTheme();
      } else if (target.id === 'realtime-checkbox') {
        const checkbox = target as HTMLInputElement;
        this.state.isRealTimeEnabled = checkbox.checked;
        this.setupRealTimeUpdates();
      }
    });
    
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      
      if (target.id === 'refresh-dashboard') {
        this.refreshDashboard();
      } else if (target.id === 'export-dashboard') {
        this.exportDashboard();
      } else if (target.classList.contains('alert-dismiss')) {
        this.dismissAlert(target.dataset.alertId || '');
      } else if (target.classList.contains('section-minimize')) {
        this.toggleSectionMinimize(target);
      }
    });
  }
  
  /**
   * Setup resize observer for responsive charts
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const chartCanvas = entry.target.querySelector('canvas');
        if (chartCanvas) {
          const chartId = chartCanvas.id.replace('chart-', '');
          const chart = this.chartInstances.get(chartId);
          if (chart) {
            chart.resize();
          }
        }
      });
    });
    
    // Observe chart containers
    document.addEventListener('DOMContentLoaded', () => {
      const chartContainers = document.querySelectorAll('.chart-widget');
      chartContainers.forEach(container => {
        this.resizeObserver?.observe(container);
      });
    });
  }
  
  /**
   * Apply theme to dashboard
   */
  private applyTheme(): void {
    const root = document.documentElement;
    
    if (this.state.theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.state.theme = prefersDark ? 'dark' : 'light';
    }
    
    root.setAttribute('data-theme', this.state.theme);
  }
  
  /**
   * Refresh dashboard data
   */
  private refreshDashboard(): void {
    console.log('Refreshing dashboard...');
    this.loadDashboard(this.state.currentDashboard);
  }
  
  /**
   * Export dashboard data
   */
  private exportDashboard(): void {
    const exportData = {
      dashboard: this.state.currentDashboard,
      timestamp: new Date().toISOString(),
      layout: this.state.layout,
      theme: this.state.theme
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  /**
   * Dismiss alert
   */
  private dismissAlert(alertId: string): void {
    const alertElement = document.querySelector(`[data-alert-id="${alertId}"]`);
    if (alertElement) {
      alertElement.remove();
    }
  }
  
  /**
   * Toggle section minimize state
   */
  private toggleSectionMinimize(button: HTMLElement): void {
    const section = button.closest('.dashboard-section');
    if (section) {
      section.classList.toggle('minimized');
      const icon = button.querySelector('i');
      if (icon) {
        icon.className = section.classList.contains('minimized') ? 'icon-plus' : 'icon-minus';
      }
    }
  }
  
  /**
   * Show toast notification
   */
  private showToastNotification(message: string, severity: string): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${severity}`;
    toast.innerHTML = `
      <div class="toast-content">
        <i class="icon-${this.getAlertIcon(severity)}"></i>
        <span>${message}</span>
      </div>
      <button class="toast-close">
        <i class="icon-x"></i>
      </button>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
    
    // Remove on click
    toast.querySelector('.toast-close')?.addEventListener('click', () => {
      toast.remove();
    });
  }
  
  /**
   * Create alert element
   */
  private createAlertElement(alert: AlertItem): HTMLElement {
    const alertElement = document.createElement('div');
    const timeAgo = this.formatTimeAgo(alert.timestamp);
    
    alertElement.className = `alert alert-${alert.severity}`;
    alertElement.setAttribute('data-alert-id', alert.id);
    alertElement.innerHTML = `
      <div class="alert-content">
        <div class="alert-header">
          <i class="icon-${this.getAlertIcon(alert.severity)}"></i>
          <span class="alert-time">${timeAgo}</span>
        </div>
        <div class="alert-message">${alert.message}</div>
        ${alert.actionUrl ? `<a href="${alert.actionUrl}" class="alert-action">Take Action</a>` : ''}
      </div>
      <button class="alert-dismiss" data-alert-id="${alert.id}">
        <i class="icon-x"></i>
      </button>
    `;
    
    return alertElement;
  }
  
  // Utility methods
  
  private getDashboardTitle(): string {
    switch (this.state.currentDashboard) {
      case 'executive': return 'Executive Dashboard';
      case 'operational': return 'Operational Dashboard';
      case 'custom': return 'Custom Dashboard';
      default: return 'Dashboard';
    }
  }
  
  private getAlertIcon(severity: string): string {
    switch (severity) {
      case 'critical': return 'alert-circle';
      case 'error': return 'x-circle';
      case 'warning': return 'alert-triangle';
      case 'info': return 'info';
      default: return 'bell';
    }
  }
  
  private formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    // Cleanup WebSocket
    if (this.socket) {
      this.socket.close();
    }
    
    // Cleanup real-time subscription
    if (this.state.subscriptionId) {
      this.businessIntelligence.unsubscribeFromRealTimeUpdates(this.state.subscriptionId);
    }
    
    // Cleanup charts
    this.chartInstances.forEach(chart => chart.destroy());
    this.chartInstances.clear();
    
    // Cleanup resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}

// Initialize dashboard when DOM is ready
let dashboardClient: Phase3DashboardClient | null = null;

document.addEventListener('DOMContentLoaded', () => {
  dashboardClient = new Phase3DashboardClient();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (dashboardClient) {
    dashboardClient.destroy();
  }
});

export { Phase3DashboardClient };
