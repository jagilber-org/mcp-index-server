/**
 * DataExporter - Phase 4 Advanced Data Export & Reporting System
 * 
 * Comprehensive data export capabilities:
 * - Multiple format support (JSON, CSV, Excel, PDF)
 * - Scheduled reporting
 * - Custom report templates
 * - Data filtering and aggregation
 * - Real-time streaming exports
 */

interface ExportConfig {
  id: string;
  name: string;
  format: 'json' | 'csv' | 'excel' | 'pdf' | 'xml';
  dataSource: 'metrics' | 'analytics' | 'security' | 'feedback' | 'instructions' | 'custom';
  filters: ExportFilter[];
  columns: ExportColumn[];
  schedule?: ExportSchedule;
  template?: string;
  compression: boolean;
  encryption: boolean;
  destination: ExportDestination;
}

interface ExportFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'between' | 'in' | 'not_in';
  value: unknown;
  values?: unknown[];
}

interface ExportColumn {
  field: string;
  header: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'json';
  format?: string;
  aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'group';
}

interface ExportSchedule {
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
  interval: number;
  time?: string; // HH:MM format
  dayOfWeek?: number; // 0-6 (Sunday-Saturday)
  dayOfMonth?: number; // 1-31
  timezone: string;
  lastRun?: number;
  nextRun?: number;
}

interface ExportDestination {
  type: 'local' | 'email' | 'ftp' | 'sftp' | 's3' | 'azure_blob' | 'webhook';
  config: Record<string, unknown>;
}

interface ExportJob {
  id: string;
  configId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  recordsProcessed: number;
  totalRecords: number;
  startTime: number;
  endTime?: number;
  error?: string;
  outputPath?: string;
  fileSize?: number;
}

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  type: 'dashboard_summary' | 'security_report' | 'performance_analysis' | 'custom';
  sections: ReportSection[];
  formatting: ReportFormatting;
}

interface ReportSection {
  id: string;
  title: string;
  type: 'text' | 'table' | 'chart' | 'metrics' | 'raw_data';
  dataSource: string;
  config: Record<string, unknown>;
  order: number;
}

interface ReportFormatting {
  pageSize: 'A4' | 'Letter' | 'Legal' | 'A3';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  fontSize: number;
  fontFamily: string;
  includeHeader: boolean;
  includeFooter: boolean;
  headerText?: string;
  footerText?: string;
}

export class DataExporter {
  private exportConfigs: Map<string, ExportConfig> = new Map();
  private exportJobs: Map<string, ExportJob> = new Map();
  private reportTemplates: Map<string, ReportTemplate> = new Map();
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
  private jobCallbacks: Array<(job: ExportJob) => void> = [];
  
  constructor() {
    this.initializeDefaultTemplates();
    this.initializeDefaultConfigs();
    this.startScheduler();
  }
  
  /**
   * Initialize default report templates
   */
  private initializeDefaultTemplates(): void {
    const defaultTemplates: ReportTemplate[] = [
      {
        id: 'daily_summary',
        name: 'Daily Summary Report',
        description: 'Comprehensive daily system summary with key metrics',
        type: 'dashboard_summary',
        sections: [
          {
            id: 'overview',
            title: 'System Overview',
            type: 'metrics',
            dataSource: 'system_health',
            config: { period: '24h' },
            order: 1
          },
          {
            id: 'security_alerts',
            title: 'Security Alerts',
            type: 'table',
            dataSource: 'security_threats',
            config: { severity: ['high', 'critical'] },
            order: 2
          },
          {
            id: 'performance_chart',
            title: 'Performance Trends',
            type: 'chart',
            dataSource: 'performance_metrics',
            config: { chartType: 'line', metrics: ['cpu', 'memory', 'api_latency'] },
            order: 3
          }
        ],
        formatting: {
          pageSize: 'A4',
          orientation: 'portrait',
          margins: { top: 20, right: 20, bottom: 20, left: 20 },
          fontSize: 12,
          fontFamily: 'Arial',
          includeHeader: true,
          includeFooter: true,
          headerText: 'MCP Index Server - Daily Report',
          footerText: 'Generated on {{date}} | Page {{page}}'
        }
      },
      {
        id: 'security_analysis',
        name: 'Security Analysis Report',
        description: 'Detailed security analysis with threat patterns and recommendations',
        type: 'security_report',
        sections: [
          {
            id: 'threat_summary',
            title: 'Threat Summary',
            type: 'metrics',
            dataSource: 'threat_statistics',
            config: { period: '7d' },
            order: 1
          },
          {
            id: 'threat_timeline',
            title: 'Threat Timeline',
            type: 'chart',
            dataSource: 'security_threats',
            config: { chartType: 'timeline', groupBy: 'type' },
            order: 2
          },
          {
            id: 'recommendations',
            title: 'Security Recommendations',
            type: 'text',
            dataSource: 'security_analysis',
            config: { includeActions: true },
            order: 3
          }
        ],
        formatting: {
          pageSize: 'A4',
          orientation: 'portrait',
          margins: { top: 25, right: 25, bottom: 25, left: 25 },
          fontSize: 11,
          fontFamily: 'Times New Roman',
          includeHeader: true,
          includeFooter: true,
          headerText: 'Security Analysis Report - {{dateRange}}',
          footerText: 'Confidential | Page {{page}} of {{totalPages}}'
        }
      }
    ];
    
    defaultTemplates.forEach(template => {
      this.reportTemplates.set(template.id, template);
    });
  }
  
  /**
   * Initialize default export configurations
   */
  private initializeDefaultConfigs(): void {
    const defaultConfigs: ExportConfig[] = [
      {
        id: 'daily_metrics_csv',
        name: 'Daily Metrics Export (CSV)',
        format: 'csv',
        dataSource: 'metrics',
        filters: [
          {
            field: 'timestamp',
            operator: 'greater_than',
            value: Date.now() - 86400000 // Last 24 hours
          }
        ],
        columns: [
          { field: 'timestamp', header: 'Timestamp', type: 'date', format: 'ISO' },
          { field: 'metric_type', header: 'Metric Type', type: 'string' },
          { field: 'value', header: 'Value', type: 'number' },
          { field: 'unit', header: 'Unit', type: 'string' }
        ],
        schedule: {
          enabled: true,
          frequency: 'daily',
          interval: 1,
          time: '06:00',
          timezone: 'UTC'
        },
        compression: true,
        encryption: false,
        destination: {
          type: 'local',
          config: { path: './exports/daily-metrics' }
        }
      },
      {
        id: 'security_report_pdf',
        name: 'Weekly Security Report (PDF)',
        format: 'pdf',
        dataSource: 'security',
        filters: [
          {
            field: 'timestamp',
            operator: 'between',
            value: null,
            values: [Date.now() - 604800000, Date.now()] // Last 7 days
          }
        ],
        columns: [
          { field: 'id', header: 'Threat ID', type: 'string' },
          { field: 'type', header: 'Threat Type', type: 'string' },
          { field: 'severity', header: 'Severity', type: 'string' },
          { field: 'timestamp', header: 'Detected', type: 'date', format: 'readable' },
          { field: 'status', header: 'Status', type: 'string' }
        ],
        template: 'security_analysis',
        schedule: {
          enabled: true,
          frequency: 'weekly',
          interval: 1,
          dayOfWeek: 1, // Monday
          time: '08:00',
          timezone: 'UTC'
        },
        compression: false,
        encryption: true,
        destination: {
          type: 'email',
          config: {
            to: ['security@company.com'],
            subject: 'Weekly Security Report - {{dateRange}}',
            body: 'Please find attached the weekly security report for the MCP Index Server.'
          }
        }
      }
    ];
    
    defaultConfigs.forEach(config => {
      this.exportConfigs.set(config.id, config);
      this.scheduleExport(config);
    });
  }
  
  /**
   * Start the export scheduler
   */
  private startScheduler(): void {
    // Check for scheduled exports every minute
    setInterval(() => {
      this.checkScheduledExports();
    }, 60000);
  }
  
  /**
   * Check for scheduled exports that need to run
   */
  private checkScheduledExports(): void {
    const now = Date.now();
    
    this.exportConfigs.forEach(config => {
      if (!config.schedule?.enabled) return;
      
      const nextRun = config.schedule.nextRun;
      if (nextRun && now >= nextRun) {
        this.executeExport(config.id);
        this.scheduleExport(config);
      }
    });
  }
  
  /**
   * Schedule an export based on its configuration
   */
  private scheduleExport(config: ExportConfig): void {
    if (!config.schedule?.enabled) return;
    
    const schedule = config.schedule;
    const now = Date.now();
    let nextRun: number;
    
    switch (schedule.frequency) {
      case 'hourly':
        nextRun = now + (schedule.interval * 3600000);
        break;
      case 'daily':
        nextRun = this.getNextDailyRun(schedule);
        break;
      case 'weekly':
        nextRun = this.getNextWeeklyRun(schedule);
        break;
      case 'monthly':
        nextRun = this.getNextMonthlyRun(schedule);
        break;
      case 'custom':
        nextRun = now + (schedule.interval * 1000);
        break;
      default:
        return;
    }
    
    schedule.nextRun = nextRun;
    schedule.lastRun = now;
  }
  
  /**
   * Calculate next daily run time
   */
  private getNextDailyRun(schedule: ExportSchedule): number {
    const now = new Date();
    const [hours, minutes] = (schedule.time || '00:00').split(':').map(Number);
    
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);
    
    // If time has passed today, schedule for tomorrow
    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setDate(nextRun.getDate() + schedule.interval);
    }
    
    return nextRun.getTime();
  }
  
  /**
   * Calculate next weekly run time
   */
  private getNextWeeklyRun(schedule: ExportSchedule): number {
    const now = new Date();
    const [hours, minutes] = (schedule.time || '00:00').split(':').map(Number);
    const targetDay = schedule.dayOfWeek || 0;
    
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);
    
    const currentDay = now.getDay();
    const daysUntilTarget = (targetDay - currentDay + 7) % 7;
    
    if (daysUntilTarget === 0 && nextRun.getTime() <= now.getTime()) {
      // Target day is today but time has passed, schedule for next week
      nextRun.setDate(nextRun.getDate() + 7);
    } else if (daysUntilTarget > 0) {
      nextRun.setDate(nextRun.getDate() + daysUntilTarget);
    }
    
    return nextRun.getTime();
  }
  
  /**
   * Calculate next monthly run time
   */
  private getNextMonthlyRun(schedule: ExportSchedule): number {
    const now = new Date();
    const [hours, minutes] = (schedule.time || '00:00').split(':').map(Number);
    const targetDay = schedule.dayOfMonth || 1;
    
    const nextRun = new Date(now);
    nextRun.setDate(targetDay);
    nextRun.setHours(hours, minutes, 0, 0);
    
    // If target day has passed this month, schedule for next month
    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setMonth(nextRun.getMonth() + schedule.interval);
    }
    
    return nextRun.getTime();
  }
  
  /**
   * Execute an export job
   */
  async executeExport(configId: string): Promise<string> {
    const config = this.exportConfigs.get(configId);
    if (!config) {
      throw new Error(`Export configuration not found: ${configId}`);
    }
    
    const jobId = `export_${configId}_${Date.now()}`;
    const job: ExportJob = {
      id: jobId,
      configId,
      status: 'pending',
      progress: 0,
      recordsProcessed: 0,
      totalRecords: 0,
      startTime: Date.now()
    };
    
    this.exportJobs.set(jobId, job);
    this.notifyJobUpdate(job);
    
    try {
      job.status = 'running';
      this.notifyJobUpdate(job);
      
      // Get data based on configuration
      const data = await this.getData(config);
      job.totalRecords = Array.isArray(data) ? data.length : 1;
      
      // Filter data
      const filteredData = this.applyFilters(data, config.filters);
      
      // Transform data according to columns configuration
      const transformedData = this.transformData(filteredData, config.columns);
      
      // Export data in specified format
      const outputPath = await this.exportData(transformedData, config);
      
      job.status = 'completed';
      job.progress = 100;
      job.endTime = Date.now();
      job.outputPath = outputPath;
      job.fileSize = await this.getFileSize(outputPath);
      
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.endTime = Date.now();
    }
    
    this.notifyJobUpdate(job);
    return jobId;
  }
  
  /**
   * Get data from specified source
   */
  private async getData(config: ExportConfig): Promise<unknown[]> {
    switch (config.dataSource) {
      case 'metrics':
        return this.getMetricsData();
      case 'analytics':
        return this.getAnalyticsData();
      case 'security':
        return this.getSecurityData();
      case 'feedback':
        return this.getFeedbackData();
      case 'instructions':
        return this.getInstructionsData();
      case 'custom':
        return this.getCustomData(config);
      default:
        throw new Error(`Unsupported data source: ${config.dataSource}`);
    }
  }
  
  /**
   * Apply filters to data
   */
  private applyFilters(data: unknown[], filters: ExportFilter[]): unknown[] {
    if (!filters.length) return data;
    
    return data.filter(item => {
      return filters.every(filter => this.evaluateFilter(item, filter));
    });
  }
  
  /**
   * Evaluate a single filter against a data item
   */
  private evaluateFilter(item: unknown, filter: ExportFilter): boolean {
    if (!item || typeof item !== 'object') return false;
    
    const value = (item as Record<string, unknown>)[filter.field];
    
    switch (filter.operator) {
      case 'equals':
        return value === filter.value;
      case 'not_equals':
        return value !== filter.value;
      case 'contains':
        return String(value).includes(String(filter.value));
      case 'not_contains':
        return !String(value).includes(String(filter.value));
      case 'greater_than':
        return Number(value) > Number(filter.value);
      case 'less_than':
        return Number(value) < Number(filter.value);
      case 'between': {
        if (!filter.values || filter.values.length !== 2) return false;
        const numValue = Number(value);
        return numValue >= Number(filter.values[0]) && numValue <= Number(filter.values[1]);
      }
      case 'in':
        return filter.values ? filter.values.includes(value) : false;
      case 'not_in':
        return filter.values ? !filter.values.includes(value) : true;
      default:
        return true;
    }
  }
  
  /**
   * Transform data according to column configuration
   */
  private transformData(data: unknown[], columns: ExportColumn[]): unknown[] {
    if (!columns.length) return data;
    
    return data.map(item => {
      if (!item || typeof item !== 'object') return item;
      
      const transformedItem: Record<string, unknown> = {};
      const itemRecord = item as Record<string, unknown>;
      
      columns.forEach(column => {
        let value = itemRecord[column.field];
        
        // Apply type conversion and formatting
        switch (column.type) {
          case 'date':
            if (typeof value === 'number') {
              const date = new Date(value);
              value = column.format === 'ISO' ? date.toISOString() : date.toLocaleString();
            }
            break;
          case 'number':
            value = Number(value);
            break;
          case 'boolean':
            value = Boolean(value);
            break;
          case 'json':
            value = typeof value === 'object' ? JSON.stringify(value) : value;
            break;
          case 'string':
          default:
            value = String(value);
            break;
        }
        
        transformedItem[column.header] = value;
      });
      
      return transformedItem;
    });
  }
  
  /**
   * Export data in specified format
   */
  private async exportData(data: unknown[], config: ExportConfig): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${config.name}_${timestamp}.${config.format}`;
    const outputPath = this.getOutputPath(config, fileName);
    
    switch (config.format) {
      case 'json':
        await this.exportJSON(data, outputPath, config);
        break;
      case 'csv':
        await this.exportCSV(data, outputPath, config);
        break;
      case 'excel':
        await this.exportExcel(data, outputPath, config);
        break;
      case 'pdf':
        await this.exportPDF(data, outputPath, config);
        break;
      case 'xml':
        await this.exportXML(data, outputPath, config);
        break;
      default:
        throw new Error(`Unsupported export format: ${config.format}`);
    }
    
    return outputPath;
  }
  
  /**
   * Get output path for export
   */
  private getOutputPath(config: ExportConfig, fileName: string): string {
    const destination = config.destination;
    
    if (destination.type === 'local') {
      const basePath = (destination.config.path as string) || './exports';
      return `${basePath}/${fileName}`;
    }
    
    // For other destination types, use temporary local path
    return `./tmp/exports/${fileName}`;
  }
  
  /**
   * Export data as JSON
   */
  private async exportJSON(data: unknown[], outputPath: string, config: ExportConfig): Promise<void> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(outputPath, jsonData, 'utf8');
    
    if (config.compression) {
      await this.compressFile(outputPath);
    }
  }
  
  /**
   * Export data as CSV
   */
  private async exportCSV(data: unknown[], outputPath: string, config: ExportConfig): Promise<void> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    
    if (!data.length) {
      await fs.writeFile(outputPath, '', 'utf8');
      return;
    }
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    // Get headers from first row
    const headers = Object.keys(data[0] as Record<string, unknown>);
    
    // Build CSV content
    const csvRows = [
      headers.join(','),
      ...data.map(row => {
        const rowRecord = row as Record<string, unknown>;
        return headers.map(header => {
          const value = rowRecord[header];
          const stringValue = String(value || '');
          // Escape quotes and wrap in quotes if contains comma or quote
          return stringValue.includes(',') || stringValue.includes('"') 
            ? `"${stringValue.replace(/"/g, '""')}"` 
            : stringValue;
        }).join(',');
      })
    ];
    
    await fs.writeFile(outputPath, csvRows.join('\n'), 'utf8');
    
    if (config.compression) {
      await this.compressFile(outputPath);
    }
  }
  
  /**
   * Export data as Excel (simplified implementation)
   */
  private async exportExcel(data: unknown[], outputPath: string, _config: ExportConfig): Promise<void> {
    // This is a simplified implementation - in a real scenario, you'd use a library like xlsx
    await this.exportCSV(data, outputPath.replace('.excel', '.csv'), _config);
  }
  
  /**
   * Export data as PDF using template
   */
  private async exportPDF(data: unknown[], outputPath: string, config: ExportConfig): Promise<void> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    let content: string;
    
    if (config.template) {
      content = await this.generateReportFromTemplate(config.template, data);
    } else {
      content = this.generateSimplePDFContent(data);
    }
    
    // In a real implementation, you'd use a PDF library like puppeteer or pdfkit
    // For now, save as HTML that can be converted to PDF
    await fs.writeFile(outputPath.replace('.pdf', '.html'), content, 'utf8');
  }
  
  /**
   * Export data as XML
   */
  private async exportXML(data: unknown[], outputPath: string, config: ExportConfig): Promise<void> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    const xmlContent = this.convertToXML(data);
    await fs.writeFile(outputPath, xmlContent, 'utf8');
    
    if (config.compression) {
      await this.compressFile(outputPath);
    }
  }
  
  /**
   * Convert data to XML format
   */
  private convertToXML(data: unknown[]): string {
    const xmlRows = data.map(item => {
      const itemRecord = item as Record<string, unknown>;
      const xmlFields = Object.entries(itemRecord)
        .map(([key, value]) => `    <${key}>${this.escapeXML(String(value))}</${key}>`)
        .join('\n');
      return `  <record>\n${xmlFields}\n  </record>`;
    });
    
    return `<?xml version="1.0" encoding="UTF-8"?>\n<data>\n${xmlRows.join('\n')}\n</data>`;
  }
  
  /**
   * Escape XML special characters
   */
  private escapeXML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  
  /**
   * Generate report from template
   */
  private async generateReportFromTemplate(templateId: string, data: unknown[]): Promise<string> {
    const template = this.reportTemplates.get(templateId);
    if (!template) {
      throw new Error(`Report template not found: ${templateId}`);
    }
    
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>${template.name}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: ${template.formatting.fontFamily}; font-size: ${template.formatting.fontSize}px; }
        .header { text-align: center; border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 20px; }
        .footer { text-align: center; border-top: 1px solid #ccc; padding-top: 10px; margin-top: 20px; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>`;
    
    if (template.formatting.includeHeader) {
      const headerText = this.replaceTemplateVariables(template.formatting.headerText || '');
      html += `<div class="header">${headerText}</div>`;
    }
    
    // Process sections in order
    const sortedSections = template.sections.sort((a, b) => a.order - b.order);
    
    for (const section of sortedSections) {
      html += `<div class="section">`;
      html += `<div class="section-title">${section.title}</div>`;
      
      switch (section.type) {
        case 'table':
          html += this.generateTableSection(data, section);
          break;
        case 'metrics':
          html += this.generateMetricsSection(data, section);
          break;
        case 'text':
          html += this.generateTextSection(data, section);
          break;
        default:
          html += `<p>Section type "${section.type}" not implemented</p>`;
      }
      
      html += `</div>`;
    }
    
    if (template.formatting.includeFooter) {
      const footerText = this.replaceTemplateVariables(template.formatting.footerText || '');
      html += `<div class="footer">${footerText}</div>`;
    }
    
    html += `</body></html>`;
    
    return html;
  }
  
  /**
   * Generate simple PDF content
   */
  private generateSimplePDFContent(data: unknown[]): string {
    if (!data.length) return '<html><body><p>No data to export</p></body></html>';
    
    const headers = Object.keys(data[0] as Record<string, unknown>);
    
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>Data Export</title>
    <style>
        body { font-family: Arial, sans-serif; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Data Export</h1>
    <table>
        <thead>
            <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>`;
    
    data.forEach(row => {
      const rowRecord = row as Record<string, unknown>;
      html += `<tr>${headers.map(h => `<td>${String(rowRecord[h] || '')}</td>`).join('')}</tr>`;
    });
    
    html += `        </tbody>
    </table>
</body>
</html>`;
    
    return html;
  }
  
  /**
   * Generate table section for report
   */
  private generateTableSection(data: unknown[], _section: ReportSection): string {
    if (!data.length) return '<p>No data available</p>';
    
    const headers = Object.keys(data[0] as Record<string, unknown>);
    
    let html = '<table><thead><tr>';
    headers.forEach(header => {
      html += `<th>${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    data.forEach(row => {
      const rowRecord = row as Record<string, unknown>;
      html += '<tr>';
      headers.forEach(header => {
        html += `<td>${String(rowRecord[header] || '')}</td>`;
      });
      html += '</tr>';
    });
    
    html += '</tbody></table>';
    return html;
  }
  
  /**
   * Generate metrics section for report
   */
  private generateMetricsSection(_data: unknown[], _section: ReportSection): string {
    // Simplified metrics section
    return `<div>
        <p><strong>Total Records:</strong> ${_data.length}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
    </div>`;
  }
  
  /**
   * Generate text section for report
   */
  private generateTextSection(_data: unknown[], section: ReportSection): string {
    // Simplified text section
    return `<p>This is a ${section.dataSource} section with ${_data.length} records.</p>`;
  }
  
  /**
   * Replace template variables
   */
  private replaceTemplateVariables(text: string): string {
    const now = new Date();
    
    return text
      .replace(/\{\{date\}\}/g, now.toLocaleDateString())
      .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
      .replace(/\{\{datetime\}\}/g, now.toLocaleString())
      .replace(/\{\{page\}\}/g, '1')
      .replace(/\{\{totalPages\}\}/g, '1')
      .replace(/\{\{dateRange\}\}/g, 'Last 7 days');
  }
  
  /**
   * Compress file
   */
  private async compressFile(filePath: string): Promise<void> {
    // In a real implementation, you'd use a compression library like zlib
    console.log(`Compressing file: ${filePath}`);
  }
  
  /**
   * Get file size
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const fs = await import('fs').then(m => m.promises);
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
  
  /**
   * Data source methods (simplified implementations)
   */
  
  private getMetricsData(): unknown[] {
    // Simulated metrics data
    return Array.from({ length: 100 }, (_, i) => ({
      id: `metric_${i}`,
      timestamp: Date.now() - (i * 60000),
      metric_type: ['cpu', 'memory', 'disk', 'network'][i % 4],
      value: Math.random() * 100,
      unit: ['percentage', 'MB', 'GB', 'Mbps'][i % 4]
    }));
  }
  
  private getAnalyticsData(): unknown[] {
    // Simulated analytics data
    return Array.from({ length: 50 }, (_, i) => ({
      id: `analytics_${i}`,
      timestamp: Date.now() - (i * 3600000),
      event_type: ['page_view', 'api_call', 'error', 'warning'][i % 4],
      count: Math.floor(Math.random() * 1000),
      source: ['dashboard', 'api', 'webhook', 'scheduler'][i % 4]
    }));
  }
  
  private getSecurityData(): unknown[] {
    // Simulated security data
    return Array.from({ length: 20 }, (_, i) => ({
      id: `threat_${i}`,
      timestamp: Date.now() - (i * 7200000),
      type: ['rate_limit_exceeded', 'suspicious_activity', 'authentication_failure'][i % 3],
      severity: ['low', 'medium', 'high', 'critical'][i % 4],
      source: `192.168.1.${100 + i}`,
      status: ['active', 'mitigated', 'resolved'][i % 3]
    }));
  }
  
  private getFeedbackData(): unknown[] {
    // Simulated feedback data
    return Array.from({ length: 30 }, (_, i) => ({
      id: `feedback_${i}`,
      timestamp: Date.now() - (i * 86400000),
      type: ['bug-report', 'feature-request', 'issue'][i % 3],
      severity: ['low', 'medium', 'high'][i % 3],
      title: `Sample feedback item ${i}`,
      status: ['new', 'acknowledged', 'in-progress', 'resolved'][i % 4]
    }));
  }
  
  private getInstructionsData(): unknown[] {
    // Simulated instructions data
    return Array.from({ length: 40 }, (_, i) => ({
      id: `instruction_${i}`,
      timestamp: Date.now() - (i * 3600000),
      type: 'instruction',
      title: `Sample instruction ${i}`,
      author: `user_${i % 5}`,
      status: ['active', 'draft', 'archived'][i % 3]
    }));
  }
  
  private getCustomData(_config: ExportConfig): unknown[] {
    // Placeholder for custom data sources
    return [];
  }
  
  /**
   * Notify job update
   */
  private notifyJobUpdate(job: ExportJob): void {
    this.jobCallbacks.forEach(callback => {
      try {
        callback(job);
      } catch (error) {
        console.error('Error in export job callback:', error);
      }
    });
  }
  
  // Public API methods
  
  /**
   * Create export configuration
   */
  createExportConfig(config: Omit<ExportConfig, 'id'>): string {
    const id = `export_${Date.now()}`;
    const fullConfig: ExportConfig = { id, ...config };
    
    this.exportConfigs.set(id, fullConfig);
    
    if (fullConfig.schedule?.enabled) {
      this.scheduleExport(fullConfig);
    }
    
    return id;
  }
  
  /**
   * Get export configuration
   */
  getExportConfig(id: string): ExportConfig | undefined {
    return this.exportConfigs.get(id);
  }
  
  /**
   * List all export configurations
   */
  listExportConfigs(): ExportConfig[] {
    return Array.from(this.exportConfigs.values());
  }
  
  /**
   * Update export configuration
   */
  updateExportConfig(id: string, updates: Partial<ExportConfig>): boolean {
    const config = this.exportConfigs.get(id);
    if (!config) return false;
    
    Object.assign(config, updates);
    
    if (config.schedule?.enabled) {
      this.scheduleExport(config);
    }
    
    return true;
  }
  
  /**
   * Delete export configuration
   */
  deleteExportConfig(id: string): boolean {
    const deleted = this.exportConfigs.delete(id);
    
    // Cancel scheduled job if exists
    const scheduledJob = this.scheduledJobs.get(id);
    if (scheduledJob) {
      clearTimeout(scheduledJob);
      this.scheduledJobs.delete(id);
    }
    
    return deleted;
  }
  
  /**
   * Get export job
   */
  getExportJob(id: string): ExportJob | undefined {
    return this.exportJobs.get(id);
  }
  
  /**
   * List export jobs
   */
  listExportJobs(configId?: string): ExportJob[] {
    const jobs = Array.from(this.exportJobs.values());
    return configId ? jobs.filter(job => job.configId === configId) : jobs;
  }
  
  /**
   * Cancel export job
   */
  cancelExportJob(id: string): boolean {
    const job = this.exportJobs.get(id);
    if (!job || job.status !== 'running') return false;
    
    job.status = 'cancelled';
    job.endTime = Date.now();
    this.notifyJobUpdate(job);
    
    return true;
  }
  
  /**
   * Register job update callback
   */
  onJobUpdate(callback: (job: ExportJob) => void): void {
    this.jobCallbacks.push(callback);
  }
  
  /**
   * Create report template
   */
  createReportTemplate(template: Omit<ReportTemplate, 'id'>): string {
    const id = `template_${Date.now()}`;
    const fullTemplate: ReportTemplate = { id, ...template };
    
    this.reportTemplates.set(id, fullTemplate);
    return id;
  }
  
  /**
   * Get report template
   */
  getReportTemplate(id: string): ReportTemplate | undefined {
    return this.reportTemplates.get(id);
  }
  
  /**
   * List report templates
   */
  listReportTemplates(): ReportTemplate[] {
    return Array.from(this.reportTemplates.values());
  }

  /**
   * Get active export jobs
   */
  getActiveJobs(): ExportJob[] {
    const activeJobs: ExportJob[] = [];
    const jobValues = Array.from(this.exportJobs.values());
    for (const job of jobValues) {
      if (job.status === 'pending' || job.status === 'running') {
        activeJobs.push(job);
      }
    }
    return activeJobs;
  }
}
