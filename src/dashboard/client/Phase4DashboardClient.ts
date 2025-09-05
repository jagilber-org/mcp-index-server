/**
 * Phase4DashboardClient - Advanced Enterprise Dashboard Client
 * 
 * Integrates all Phase 4 advanced features:
 * - Security monitoring dashboard
 * - Data export interface
 * - API integration management
 * - Real-time threat detection
 * - Performance optimization
 */

import { SecurityMonitor, getSecurityMonitor } from '../security/SecurityMonitor.js';
import { DataExporter } from '../export/DataExporter.js';
import { APIIntegration, getAPIIntegration } from '../integration/APIIntegration.js';

interface Phase4UIComponents {
  securityDashboard: HTMLElement;
  exportInterface: HTMLElement;
  apiManagement: HTMLElement;
  threatAlertsPanel: HTMLElement;
  performanceMonitor: HTMLElement;
  systemHealthWidget: HTMLElement;
}

interface SecurityAlert {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  status: 'active' | 'acknowledged' | 'resolved';
  actionRequired: boolean;
}

interface ExportTemplate {
  id: string;
  name: string;
  description: string;
  format: string;
  schedule: string;
  lastRun?: number;
}

export class Phase4DashboardClient {
  private container: HTMLElement;
  private components: Phase4UIComponents;
  private securityMonitor: SecurityMonitor;
  private dataExporter: DataExporter;
  private apiIntegration: APIIntegration;
  private updateInterval: NodeJS.Timeout | null = null;
  private alertsQueue: SecurityAlert[] = [];
  private theme: 'light' | 'dark' = 'dark';
  
  constructor(
    container: HTMLElement,
    securityMonitor?: SecurityMonitor,
    dataExporter?: DataExporter,
    apiIntegration?: APIIntegration
  ) {
    this.container = container;
    this.securityMonitor = securityMonitor || getSecurityMonitor();
    this.dataExporter = dataExporter || new DataExporter();
    this.apiIntegration = apiIntegration || getAPIIntegration();
    
    this.components = this.initializeComponents();
    this.setupEventListeners();
  }

  /**
   * Initialize the dashboard
   */
  initialize(): void {
    this.startRealTimeUpdates();
  }
  
  /**
   * Initialize Phase 4 UI components
   */
  private initializeComponents(): Phase4UIComponents {
    this.container.innerHTML = `
      <div class="phase4-dashboard ${this.theme}">
        <!-- Main Navigation -->
        <nav class="dashboard-nav">
          <div class="nav-brand">
            <h1>🛡️ Enterprise Security Center</h1>
          </div>
          <div class="nav-tabs">
            <button class="nav-tab active" data-tab="security">🔒 Security</button>
            <button class="nav-tab" data-tab="exports">📊 Exports</button>
            <button class="nav-tab" data-tab="apis">🔌 APIs</button>
            <button class="nav-tab" data-tab="monitoring">📈 Monitoring</button>
          </div>
          <div class="nav-controls">
            <button class="theme-toggle" title="Toggle Theme">🌓</button>
            <button class="refresh-btn" title="Refresh">🔄</button>
            <button class="settings-btn" title="Settings">⚙️</button>
          </div>
        </nav>
        
        <!-- Global Alerts Banner -->
        <div class="alerts-banner" id="alertsBanner" style="display: none;">
          <div class="alert-content">
            <span class="alert-icon">⚠️</span>
            <span class="alert-message" id="alertMessage"></span>
            <button class="alert-dismiss" id="alertDismiss">✕</button>
          </div>
        </div>
        
        <!-- System Health Header -->
        <div class="system-health-header" id="systemHealthWidget">
          <div class="health-status">
            <div class="status-indicator" id="healthIndicator">🟢</div>
            <span class="status-text" id="healthStatus">System Healthy</span>
          </div>
          <div class="health-metrics">
            <div class="metric">
              <span class="metric-label">Uptime</span>
              <span class="metric-value" id="systemUptime">--</span>
            </div>
            <div class="metric">
              <span class="metric-label">Active Threats</span>
              <span class="metric-value" id="activeThreats">0</span>
            </div>
            <div class="metric">
              <span class="metric-label">API Status</span>
              <span class="metric-value" id="apiStatus">--</span>
            </div>
          </div>
        </div>
        
        <!-- Main Content Tabs -->
        <div class="tab-content">
          <!-- Security Tab -->
          <div class="tab-pane active" id="securityDashboard" data-tab="security">
            <div class="security-grid">
              <!-- Threat Detection Panel -->
              <div class="security-panel threats-panel">
                <div class="panel-header">
                  <h3>🚨 Threat Detection</h3>
                  <button class="panel-refresh" data-panel="threats">🔄</button>
                </div>
                <div class="threats-content" id="threatAlertsPanel">
                  <div class="threat-summary">
                    <div class="threat-stat critical">
                      <span class="count" id="criticalThreats">0</span>
                      <span class="label">Critical</span>
                    </div>
                    <div class="threat-stat high">
                      <span class="count" id="highThreats">0</span>
                      <span class="label">High</span>
                    </div>
                    <div class="threat-stat medium">
                      <span class="count" id="mediumThreats">0</span>
                      <span class="label">Medium</span>
                    </div>
                    <div class="threat-stat low">
                      <span class="count" id="lowThreats">0</span>
                      <span class="label">Low</span>
                    </div>
                  </div>
                  <div class="threats-list" id="threatsList">
                    <!-- Threat items will be populated here -->
                  </div>
                </div>
              </div>
              
              <!-- Performance Monitor Panel -->
              <div class="security-panel performance-panel">
                <div class="panel-header">
                  <h3>📊 Performance Monitor</h3>
                  <select class="time-range-selector" id="perfTimeRange">
                    <option value="1h">Last Hour</option>
                    <option value="6h">Last 6 Hours</option>
                    <option value="24h" selected>Last 24 Hours</option>
                    <option value="7d">Last 7 Days</option>
                  </select>
                </div>
                <div class="performance-content" id="performanceMonitor">
                  <div class="performance-metrics">
                    <div class="perf-metric">
                      <span class="metric-icon">🖥️</span>
                      <div class="metric-info">
                        <span class="metric-name">CPU Usage</span>
                        <span class="metric-value" id="cpuUsage">--</span>
                      </div>
                    </div>
                    <div class="perf-metric">
                      <span class="metric-icon">💾</span>
                      <div class="metric-info">
                        <span class="metric-name">Memory Usage</span>
                        <span class="metric-value" id="memoryUsage">--</span>
                      </div>
                    </div>
                    <div class="perf-metric">
                      <span class="metric-icon">⚡</span>
                      <div class="metric-info">
                        <span class="metric-name">API Latency</span>
                        <span class="metric-value" id="apiLatency">--</span>
                      </div>
                    </div>
                  </div>
                  <div class="performance-chart">
                    <canvas id="performanceChart" width="600" height="300"></canvas>
                  </div>
                </div>
              </div>
              
              <!-- Security Rules Panel -->
              <div class="security-panel rules-panel">
                <div class="panel-header">
                  <h3>🔧 Security Rules</h3>
                  <button class="add-rule-btn">+ Add Rule</button>
                </div>
                <div class="rules-content" id="securityRules">
                  <!-- Security rules will be populated here -->
                </div>
              </div>
            </div>
          </div>
          
          <!-- Exports Tab -->
          <div class="tab-pane" id="exportInterface" data-tab="exports">
            <div class="exports-layout">
              <!-- Export Templates -->
              <div class="exports-panel templates-panel">
                <div class="panel-header">
                  <h3>📋 Export Templates</h3>
                  <button class="create-template-btn">+ Create Template</button>
                </div>
                <div class="templates-content" id="exportTemplates">
                  <!-- Export templates will be populated here -->
                </div>
              </div>
              
              <!-- Quick Export -->
              <div class="exports-panel quick-export-panel">
                <div class="panel-header">
                  <h3>⚡ Quick Export</h3>
                </div>
                <div class="quick-export-content">
                  <form class="export-form" id="quickExportForm">
                    <div class="form-group">
                      <label for="exportDataSource">Data Source</label>
                      <select id="exportDataSource" class="form-control">
                        <option value="metrics">System Metrics</option>
                        <option value="security">Security Logs</option>
                        <option value="analytics">Analytics Data</option>
                        <option value="feedback">Feedback Records</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label for="exportFormat">Format</label>
                      <select id="exportFormat" class="form-control">
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                        <option value="excel">Excel</option>
                        <option value="pdf">PDF Report</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label for="exportTimeRange">Time Range</label>
                      <select id="exportTimeRange" class="form-control">
                        <option value="1h">Last Hour</option>
                        <option value="24h">Last 24 Hours</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                      </select>
                    </div>
                    <button type="submit" class="export-btn">📤 Export Now</button>
                  </form>
                </div>
              </div>
              
              <!-- Export Jobs -->
              <div class="exports-panel jobs-panel">
                <div class="panel-header">
                  <h3>🔄 Export Jobs</h3>
                  <button class="clear-completed-btn">🗑️ Clear Completed</button>
                </div>
                <div class="jobs-content" id="exportJobs">
                  <!-- Export jobs will be populated here -->
                </div>
              </div>
            </div>
          </div>
          
          <!-- APIs Tab -->
          <div class="tab-pane" id="apiManagement" data-tab="apis">
            <div class="apis-layout">
              <!-- API Endpoints -->
              <div class="apis-panel endpoints-panel">
                <div class="panel-header">
                  <h3>🔌 API Endpoints</h3>
                  <button class="add-endpoint-btn">+ Add Endpoint</button>
                </div>
                <div class="endpoints-content" id="apiEndpoints">
                  <!-- API endpoints will be populated here -->
                </div>
              </div>
              
              <!-- Webhooks -->
              <div class="apis-panel webhooks-panel">
                <div class="panel-header">
                  <h3>🪝 Webhooks</h3>
                  <button class="add-webhook-btn">+ Add Webhook</button>
                </div>
                <div class="webhooks-content" id="webhooks">
                  <!-- Webhooks will be populated here -->
                </div>
              </div>
              
              <!-- External Connectors -->
              <div class="apis-panel connectors-panel">
                <div class="panel-header">
                  <h3>🔗 External Connectors</h3>
                  <button class="test-all-connectors-btn">🧪 Test All</button>
                </div>
                <div class="connectors-content" id="externalConnectors">
                  <!-- External connectors will be populated here -->
                </div>
              </div>
            </div>
          </div>
          
          <!-- Monitoring Tab -->
          <div class="tab-pane" id="monitoringDashboard" data-tab="monitoring">
            <div class="monitoring-layout">
              <!-- Real-time Metrics -->
              <div class="monitoring-panel metrics-panel">
                <div class="panel-header">
                  <h3>📊 Real-time Metrics</h3>
                  <div class="metrics-controls">
                    <button class="pause-metrics-btn" id="pauseMetrics">⏸️ Pause</button>
                    <button class="reset-metrics-btn">🔄 Reset</button>
                  </div>
                </div>
                <div class="metrics-content">
                  <canvas id="realTimeMetricsChart" width="800" height="400"></canvas>
                </div>
              </div>
              
              <!-- System Health Details -->
              <div class="monitoring-panel health-details-panel">
                <div class="panel-header">
                  <h3>🏥 System Health Details</h3>
                </div>
                <div class="health-details-content" id="healthDetails">
                  <!-- Health details will be populated here -->
                </div>
              </div>
              
              <!-- Alerts History -->
              <div class="monitoring-panel alerts-history-panel">
                <div class="panel-header">
                  <h3>📜 Alerts History</h3>
                  <div class="alerts-filters">
                    <select id="alertsFilter">
                      <option value="all">All Alerts</option>
                      <option value="critical">Critical Only</option>
                      <option value="unresolved">Unresolved</option>
                    </select>
                  </div>
                </div>
                <div class="alerts-history-content" id="alertsHistory">
                  <!-- Alerts history will be populated here -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    return {
      securityDashboard: this.container.querySelector('#securityDashboard')!,
      exportInterface: this.container.querySelector('#exportInterface')!,
      apiManagement: this.container.querySelector('#apiManagement')!,
      threatAlertsPanel: this.container.querySelector('#threatAlertsPanel')!,
      performanceMonitor: this.container.querySelector('#performanceMonitor')!,
      systemHealthWidget: this.container.querySelector('#systemHealthWidget')!
    };
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Navigation tabs
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      if (target.classList.contains('nav-tab')) {
        this.switchTab(target.dataset.tab!);
      }
      
      if (target.classList.contains('theme-toggle')) {
        this.toggleTheme();
      }
      
      if (target.classList.contains('refresh-btn')) {
        this.refreshAllData();
      }
      
      if (target.classList.contains('panel-refresh')) {
        this.refreshPanel(target.dataset.panel!);
      }
      
      // Export form submission
      if (target.classList.contains('export-btn')) {
        e.preventDefault();
        this.handleQuickExport();
      }
      
      // Threat actions
      if (target.classList.contains('threat-action')) {
        this.handleThreatAction(target.dataset.action!, target.dataset.threatId!);
      }
      
      // API endpoint actions
      if (target.classList.contains('endpoint-action')) {
        this.handleEndpointAction(target.dataset.action!, target.dataset.endpointId!);
      }
    });
    
    // Security monitoring callbacks
    this.securityMonitor.onThreatDetected((threat) => {
      this.handleNewThreat(threat);
    });
    
    // API monitoring callbacks
    this.apiIntegration.onAPIEvent((event) => {
      this.handleAPIEvent(event);
    });
    
    // Export job callbacks
    this.dataExporter.onJobUpdate((job) => {
      this.handleExportJobUpdate(job);
    });
  }
  
  /**
   * Start real-time updates
   */
  private startRealTimeUpdates(): void {
    this.updateInterval = setInterval(() => {
      this.updateSystemHealth();
      this.updateThreatsList();
      this.updatePerformanceMetrics();
      this.updateAPIStatus();
      this.updateExportJobs();
    }, 2000); // Update every 2 seconds
  }
  
  /**
   * Switch dashboard tab
   */
  private switchTab(tabName: string): void {
    // Update nav tabs
    this.container.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', (tab as HTMLElement).dataset.tab === tabName);
    });
    
    // Update content panes
    this.container.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', (pane as HTMLElement).dataset.tab === tabName);
    });
    
    // Load tab-specific data
    switch (tabName) {
      case 'security':
        this.loadSecurityData();
        break;
      case 'exports':
        this.loadExportData();
        break;
      case 'apis':
        this.loadAPIData();
        break;
      case 'monitoring':
        this.loadMonitoringData();
        break;
    }
  }
  
  /**
   * Toggle theme
   */
  private toggleTheme(): void {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    const dashboard = this.container.querySelector('.phase4-dashboard');
    if (dashboard) {
      dashboard.className = `phase4-dashboard ${this.theme}`;
    }
  }
  
  /**
   * Refresh all data
   */
  private refreshAllData(): void {
    this.updateSystemHealth();
    this.updateThreatsList();
    this.updatePerformanceMetrics();
    this.updateAPIStatus();
    this.updateExportJobs();
    this.showNotification('Data refreshed successfully', 'success');
  }
  
  /**
   * Refresh specific panel
   */
  private refreshPanel(panelName: string): void {
    switch (panelName) {
      case 'threats':
        this.updateThreatsList();
        break;
      case 'performance':
        this.updatePerformanceMetrics();
        break;
      case 'apis':
        this.updateAPIStatus();
        break;
    }
  }
  
  /**
   * Update system health
   */
  private updateSystemHealth(): void {
    const health = this.securityMonitor.getSystemHealth();
    
    const healthIndicator = this.container.querySelector('#healthIndicator') as HTMLElement;
    const healthStatus = this.container.querySelector('#healthStatus') as HTMLElement;
    const activeThreats = this.container.querySelector('#activeThreats') as HTMLElement;
    const systemUptime = this.container.querySelector('#systemUptime') as HTMLElement;
    const apiStatus = this.container.querySelector('#apiStatus') as HTMLElement;
    
    if (healthIndicator && healthStatus) {
      switch (health.overall) {
        case 'healthy':
          healthIndicator.textContent = '🟢';
          healthStatus.textContent = 'System Healthy';
          break;
        case 'warning':
          healthIndicator.textContent = '🟡';
          healthStatus.textContent = 'System Warning';
          break;
        case 'critical':
          healthIndicator.textContent = '🔴';
          healthStatus.textContent = 'System Critical';
          break;
        case 'down':
          healthIndicator.textContent = '⚫';
          healthStatus.textContent = 'System Down';
          break;
      }
    }
    
    if (activeThreats) {
      const activeCount = health.alerts.filter(alert => alert.status === 'active').length;
      activeThreats.textContent = activeCount.toString();
    }
    
    if (systemUptime) {
      const uptime = Math.floor(process.uptime());
      systemUptime.textContent = this.formatUptime(uptime);
    }
    
    if (apiStatus) {
      const stats = this.apiIntegration.getAPIStatistics();
      apiStatus.textContent = `${stats.activeConnections}/${stats.connectors} Connected`;
    }
  }
  
  /**
   * Update threats list
   */
  private updateThreatsList(): void {
    const health = this.securityMonitor.getSystemHealth();
    const threats = health.alerts;
    
    // Update threat counts
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    threats.forEach(threat => {
      if (threat.status === 'active') {
        counts[threat.severity]++;
      }
    });
    
    ['critical', 'high', 'medium', 'low'].forEach(severity => {
      const element = this.container.querySelector(`#${severity}Threats`) as HTMLElement;
      if (element) {
        element.textContent = counts[severity as keyof typeof counts].toString();
      }
    });
    
    // Update threats list
    const threatsList = this.container.querySelector('#threatsList') as HTMLElement;
    if (threatsList) {
      threatsList.innerHTML = threats.slice(0, 10).map(threat => `
        <div class="threat-item ${threat.severity}" data-threat-id="${threat.id}">
          <div class="threat-info">
            <div class="threat-header">
              <span class="threat-type">${this.formatThreatType(threat.type)}</span>
              <span class="threat-severity ${threat.severity}">${threat.severity.toUpperCase()}</span>
            </div>
            <div class="threat-details">
              <span class="threat-source">Source: ${threat.source}</span>
              <span class="threat-time">${this.formatTime(threat.timestamp)}</span>
            </div>
          </div>
          <div class="threat-actions">
            ${threat.status === 'active' ? `
              <button class="threat-action acknowledge" data-action="acknowledge" data-threat-id="${threat.id}">
                Acknowledge
              </button>
              <button class="threat-action resolve" data-action="resolve" data-threat-id="${threat.id}">
                Resolve
              </button>
            ` : `
              <span class="threat-status">${threat.status}</span>
            `}
          </div>
        </div>
      `).join('');
    }
  }
  
  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(): void {
    const health = this.securityMonitor.getSystemHealth();
    const metrics = health.performance.slice(-3); // Last 3 metrics
    
    metrics.forEach(metric => {
      let elementId: string;
      let unit: string;
      
      switch (metric.type) {
        case 'cpu':
          elementId = 'cpuUsage';
          unit = '%';
          break;
        case 'memory':
          elementId = 'memoryUsage';
          unit = '%';
          break;
        case 'api_latency':
          elementId = 'apiLatency';
          unit = 'ms';
          break;
        default:
          return;
      }
      
      const element = this.container.querySelector(`#${elementId}`) as HTMLElement;
      if (element) {
        element.textContent = `${Math.round(metric.value)}${unit}`;
        
        // Add trend indicator
        const trendIcon = metric.trend === 'increasing' ? '↗️' : 
                         metric.trend === 'decreasing' ? '↘️' : '➡️';
        element.textContent += ` ${trendIcon}`;
      }
    });
  }
  
  /**
   * Update API status
   */
  private updateAPIStatus(): void {
    const endpoints = this.apiIntegration.listEndpoints();
    const connectors = this.apiIntegration.listConnectors();
    
    // Update API endpoints display
    const endpointsContainer = this.container.querySelector('#apiEndpoints') as HTMLElement;
    if (endpointsContainer) {
      endpointsContainer.innerHTML = endpoints.map(endpoint => `
        <div class="endpoint-item" data-endpoint-id="${endpoint.id}">
          <div class="endpoint-info">
            <div class="endpoint-name">${endpoint.name}</div>
            <div class="endpoint-url">${endpoint.method} ${endpoint.url}</div>
          </div>
          <div class="endpoint-status">
            <span class="status-indicator ${endpoint.monitoring.collectMetrics ? 'active' : 'inactive'}"></span>
          </div>
          <div class="endpoint-actions">
            <button class="endpoint-action test" data-action="test" data-endpoint-id="${endpoint.id}">
              Test
            </button>
            <button class="endpoint-action edit" data-action="edit" data-endpoint-id="${endpoint.id}">
              Edit
            </button>
          </div>
        </div>
      `).join('');
    }
    
    // Update connectors display
    const connectorsContainer = this.container.querySelector('#externalConnectors') as HTMLElement;
    if (connectorsContainer) {
      connectorsContainer.innerHTML = connectors.map(connector => `
        <div class="connector-item" data-connector-id="${connector.id}">
          <div class="connector-info">
            <div class="connector-name">${connector.name}</div>
            <div class="connector-type">${connector.type}</div>
          </div>
          <div class="connector-status">
            <span class="status-indicator ${connector.status}"></span>
            <span class="status-text">${connector.status}</span>
          </div>
          <div class="connector-metrics">
            <span class="metric">Requests: ${connector.metrics.requestCount}</span>
            <span class="metric">Errors: ${connector.metrics.errorCount}</span>
          </div>
        </div>
      `).join('');
    }
  }
  
  /**
   * Update export jobs
   */
  private updateExportJobs(): void {
    const jobs = this.dataExporter.listExportJobs();
    
    const jobsContainer = this.container.querySelector('#exportJobs') as HTMLElement;
    if (jobsContainer) {
      jobsContainer.innerHTML = jobs.slice(-10).map(job => `
        <div class="export-job-item ${job.status}" data-job-id="${job.id}">
          <div class="job-info">
            <div class="job-name">Export Job ${job.id.split('_').slice(-1)[0]}</div>
            <div class="job-details">
              <span>Status: ${job.status}</span>
              <span>Progress: ${job.progress}%</span>
              ${job.recordsProcessed ? `<span>Records: ${job.recordsProcessed}/${job.totalRecords}</span>` : ''}
            </div>
          </div>
          <div class="job-actions">
            ${job.status === 'running' ? `
              <button class="job-action cancel" data-action="cancel" data-job-id="${job.id}">
                Cancel
              </button>
            ` : job.status === 'completed' && job.outputPath ? `
              <button class="job-action download" data-action="download" data-job-id="${job.id}">
                Download
              </button>
            ` : ''}
          </div>
        </div>
      `).join('');
    }
  }
  
  /**
   * Load security data
   */
  private loadSecurityData(): void {
    this.updateThreatsList();
    this.loadSecurityRules();
  }
  
  /**
   * Load security rules
   */
  private loadSecurityRules(): void {
    const rules = this.securityMonitor.getSecurityRules();
    
    const rulesContainer = this.container.querySelector('#securityRules') as HTMLElement;
    if (rulesContainer) {
      rulesContainer.innerHTML = rules.map(rule => `
        <div class="security-rule-item ${rule.enabled ? 'enabled' : 'disabled'}" data-rule-id="${rule.id}">
          <div class="rule-info">
            <div class="rule-name">${rule.name}</div>
            <div class="rule-type">${rule.type}</div>
            ${rule.lastTriggered ? `<div class="rule-triggered">Last triggered: ${this.formatTime(rule.lastTriggered)}</div>` : ''}
          </div>
          <div class="rule-stats">
            <span class="trigger-count">Triggers: ${rule.triggerCount}</span>
          </div>
          <div class="rule-toggle">
            <label class="switch">
              <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-rule-id="${rule.id}">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      `).join('');
    }
  }
  
  /**
   * Load export data
   */
  private loadExportData(): void {
    this.loadExportTemplates();
    this.updateExportJobs();
  }
  
  /**
   * Load export templates
   */
  private loadExportTemplates(): void {
    const templates = this.dataExporter.listReportTemplates();
    
    const templatesContainer = this.container.querySelector('#exportTemplates') as HTMLElement;
    if (templatesContainer) {
      templatesContainer.innerHTML = templates.map(template => `
        <div class="export-template-item" data-template-id="${template.id}">
          <div class="template-info">
            <div class="template-name">${template.name}</div>
            <div class="template-description">${template.description}</div>
            <div class="template-type">${template.type}</div>
          </div>
          <div class="template-actions">
            <button class="template-action use" data-action="use" data-template-id="${template.id}">
              Use Template
            </button>
            <button class="template-action edit" data-action="edit" data-template-id="${template.id}">
              Edit
            </button>
          </div>
        </div>
      `).join('');
    }
  }
  
  /**
   * Load API data
   */
  private loadAPIData(): void {
    this.updateAPIStatus();
    this.loadWebhooks();
  }
  
  /**
   * Load webhooks
   */
  private loadWebhooks(): void {
    // Placeholder for webhooks - would get from APIIntegration
    const webhooksContainer = this.container.querySelector('#webhooks') as HTMLElement;
    if (webhooksContainer) {
      webhooksContainer.innerHTML = `
        <div class="placeholder">
          <p>No webhooks configured</p>
          <button class="add-webhook-btn">+ Add First Webhook</button>
        </div>
      `;
    }
  }
  
  /**
   * Load monitoring data
   */
  private loadMonitoringData(): void {
    this.initializeRealTimeChart();
    this.loadHealthDetails();
    this.loadAlertsHistory();
  }
  
  /**
   * Initialize real-time chart
   */
  private initializeRealTimeChart(): void {
    const canvas = this.container.querySelector('#realTimeMetricsChart') as HTMLCanvasElement;
    if (canvas) {
      // Initialize Chart.js chart for real-time metrics
      // This would use the same charting system as Phase 3
      console.log('Real-time metrics chart initialized');
    }
  }
  
  /**
   * Load health details
   */
  private loadHealthDetails(): void {
    const health = this.securityMonitor.getSystemHealth();
    
    const healthDetailsContainer = this.container.querySelector('#healthDetails') as HTMLElement;
    if (healthDetailsContainer) {
      healthDetailsContainer.innerHTML = `
        <div class="health-services">
          ${health.services.map(service => `
            <div class="service-item ${service.status}">
              <div class="service-name">${service.name}</div>
              <div class="service-status">${service.status}</div>
              <div class="service-metrics">
                <span>Latency: ${service.latency}ms</span>
                <span>Uptime: ${this.formatUptime(service.uptime / 1000)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }
  
  /**
   * Load alerts history
   */
  private loadAlertsHistory(): void {
    const health = this.securityMonitor.getSystemHealth();
    const allAlerts = health.alerts;
    
    const alertsHistoryContainer = this.container.querySelector('#alertsHistory') as HTMLElement;
    if (alertsHistoryContainer) {
      alertsHistoryContainer.innerHTML = allAlerts.map(alert => `
        <div class="alert-history-item ${alert.severity}">
          <div class="alert-info">
            <span class="alert-type">${this.formatThreatType(alert.type)}</span>
            <span class="alert-time">${this.formatTime(alert.timestamp)}</span>
          </div>
          <div class="alert-details">
            <span class="alert-source">${alert.source}</span>
            <span class="alert-status">${alert.status}</span>
          </div>
        </div>
      `).join('');
    }
  }
  
  /**
   * Handle new threat detection
   */
  private handleNewThreat(threat: { id: string; type: string; severity: 'low' | 'medium' | 'high' | 'critical'; source: string; timestamp: number }): void {
    // Add to alerts queue
    const alert: SecurityAlert = {
      id: threat.id,
      type: threat.type,
      severity: threat.severity,
      message: `${this.formatThreatType(threat.type)} detected from ${threat.source}`,
      timestamp: threat.timestamp,
      status: 'active',
      actionRequired: threat.severity === 'critical' || threat.severity === 'high'
    };
    
    this.alertsQueue.push(alert);
    
    // Show immediate notification for critical threats
    if (threat.severity === 'critical') {
      this.showNotification(alert.message, 'error');
    }
    
    // Update UI
    this.updateThreatsList();
  }
  
  /**
   * Handle API event
   */
  private handleAPIEvent(event: { type: string; timestamp: number; data: Record<string, unknown> }): void {
    if (event.type === 'error') {
      console.error('API Event:', event);
    }
  }
  
  /**
   * Handle export job update
   */
  private handleExportJobUpdate(job: { id: string; status: string; error?: string }): void {
    this.updateExportJobs();
    
    if (job.status === 'completed') {
      this.showNotification(`Export job completed: ${job.id}`, 'success');
    } else if (job.status === 'failed') {
      this.showNotification(`Export job failed: ${job.error}`, 'error');
    }
  }
  
  /**
   * Handle quick export
   */
  private async handleQuickExport(): Promise<void> {
    const dataSource = (this.container.querySelector('#exportDataSource') as HTMLSelectElement).value;
    const format = (this.container.querySelector('#exportFormat') as HTMLSelectElement).value;
    const timeRange = (this.container.querySelector('#exportTimeRange') as HTMLSelectElement).value;
    
    try {
      // Create export configuration
      const configId = this.dataExporter.createExportConfig({
        name: `Quick Export - ${new Date().toISOString()}`,
        format: format as 'csv' | 'json' | 'excel' | 'pdf',
        dataSource: dataSource as 'metrics' | 'instructions' | 'analytics' | 'security',
        filters: [
          {
            field: 'timestamp',
            operator: 'greater_than',
            value: this.getTimeRangeTimestamp(timeRange)
          }
        ],
        columns: [],
        compression: false,
        encryption: false,
        destination: {
          type: 'local',
          config: { path: './exports' }
        }
      });
      
      // Execute export
      const jobId = await this.dataExporter.executeExport(configId);
      this.showNotification(`Export job started: ${jobId}`, 'info');
      
    } catch (error) {
      this.showNotification(`Export failed: ${error}`, 'error');
    }
  }
  
  /**
   * Handle threat action
   */
  private handleThreatAction(action: string, threatId: string): void {
    switch (action) {
      case 'acknowledge':
        this.securityMonitor.mitigateThreat(threatId, 'Acknowledged by user');
        this.showNotification('Threat acknowledged', 'success');
        break;
      case 'resolve':
        this.securityMonitor.resolveThreat(threatId);
        this.showNotification('Threat resolved', 'success');
        break;
    }
    
    this.updateThreatsList();
  }
  
  /**
   * Handle endpoint action
   */
  private async handleEndpointAction(action: string, endpointId: string): Promise<void> {
    switch (action) {
      case 'test':
        try {
          await this.apiIntegration.executeRequest(endpointId);
          this.showNotification('Endpoint test successful', 'success');
        } catch (error) {
          this.showNotification(`Endpoint test failed: ${error}`, 'error');
        }
        break;
      case 'edit':
        this.showNotification('Edit functionality not implemented', 'info');
        break;
    }
  }
  
  /**
   * Show notification
   */
  private showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning'): void {
    const alertsBanner = this.container.querySelector('#alertsBanner') as HTMLElement;
    const alertMessage = this.container.querySelector('#alertMessage') as HTMLElement;
    
    if (alertsBanner && alertMessage) {
      alertMessage.textContent = message;
      alertsBanner.className = `alerts-banner ${type}`;
      alertsBanner.style.display = 'block';
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        alertsBanner.style.display = 'none';
      }, 5000);
    }
  }
  
  /**
   * Utility functions
   */
  
  private formatThreatType(type: string): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  
  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
  
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
  
  /**
   * Update real-time data across all dashboard components
   */
  updateRealTimeData(): void {
    this.loadSecurityData();
    this.loadExportData();
    this.loadAPIData();
    this.loadMonitoringData();
  }

  private getTimeRangeTimestamp(range: string): number {
    const now = Date.now();
    
    switch (range) {
      case '1h': return now - 3600000;
      case '24h': return now - 86400000;
      case '7d': return now - 604800000;
      case '30d': return now - 2592000000;
      default: return now - 86400000;
    }
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.container.innerHTML = '';
  }
}
