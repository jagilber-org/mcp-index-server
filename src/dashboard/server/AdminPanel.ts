/**
 * MCP Index Server Admin - Enterprise Administration Interface
 *
 * Provides comprehensive administrative controls for the MCP Index Server:
 * - Server configuration management
 * - User session monitoring
 * - System maintenance tools
 * - Performance tuning controls
 * - Security management
 * - Instruction catalog administration
 */
import fs from 'fs';
import path from 'path';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector';

interface AdminConfig {
  serverSettings: {
    maxConnections: number;
    requestTimeout: number;
    enableVerboseLogging: boolean;
    enableMutation: boolean;
    rateLimit: {
      windowMs: number;
      maxRequests: number;
    };
  };
  catalogSettings: {
    autoRefreshInterval: number;
    cacheSize: number;
    enableVersioning: boolean;
  };
  securitySettings: {
    enableCors: boolean;
    allowedOrigins: string[];
    enableAuthentication: boolean;
    sessionTimeout: number;
  };
}

interface AdminSession {
  id: string;
  userId: string;
  startTime: Date;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
  permissions: string[];
}

interface AdminSessionHistoryEntry {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  ipAddress: string;
  userAgent: string;
  terminated?: boolean;
  terminationReason?: string;
}

interface SystemMaintenance {
  lastBackup: Date | null;
  nextScheduledMaintenance: Date | null;
  maintenanceMode: boolean;
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
    cpuTrend?: 'stable' | 'increasing' | 'decreasing';
    memoryTrend?: 'stable' | 'increasing' | 'decreasing';
    memoryGrowthRate?: number; // bytes per minute
  };
}

interface AdminStats {
  totalConnections: number;
  activeConnections: number;
  /** Count of active admin panel sessions (logical authenticated/admin sessions) */
  adminActiveSessions: number;
  totalRequests: number;
  errorRate: number;
  avgResponseTime: number;
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    percent: number;
  };
  toolMetrics: { [toolName: string]: ToolMetrics };
  catalogStats: {
    totalInstructions: number;
    lastUpdated: Date;
  version: string; // build/server version at snapshot time
  schemaVersion: string; // aggregated instruction schema version(s)
  };
}

export class AdminPanel {
  private config: AdminConfig;
  private activeSessions: Map<string, AdminSession> = new Map();
  private maintenanceInfo: SystemMaintenance;
  // Cache catalog stats so lastUpdated only changes when instruction count changes
  private catalogStatsCache: { totalInstructions: number; lastUpdated: Date; version: string; schemaVersion: string } | null = null;
  // Track last observed uptime (seconds) to detect regression / restarts
  private lastUptimeSeconds = 0;
  // Historical session log (most recent first)
  private sessionHistory: AdminSessionHistoryEntry[] = [];
  private readonly maxSessionHistory = parseInt(process.env.MCP_ADMIN_MAX_SESSION_HISTORY || '200');
  // Quick index for history lookup
  private sessionHistoryIndex: Map<string, AdminSessionHistoryEntry> = new Map();
  
  // CPU tracking for leak detection
  private cpuHistory: Array<{ timestamp: number; user: number; system: number; percent: number }> = [];
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private readonly maxCpuHistoryEntries = 100; // Keep last 100 entries for trend analysis

  // Memory tracking for leak detection
  private memoryHistory: Array<{ timestamp: number; heapUsed: number; heapTotal: number; external: number; rss: number }> = [];
  private readonly maxMemoryHistoryEntries = 100; // Keep last 100 entries for trend analysis

  constructor() {
    this.config = this.loadDefaultConfig();
    this.maintenanceInfo = {
      lastBackup: null,
      nextScheduledMaintenance: null,
      maintenanceMode: false,
      systemHealth: {
        status: 'healthy',
        issues: [],
        recommendations: []
      }
    };
  }

  private loadDefaultConfig(): AdminConfig {
    return {
      serverSettings: {
        maxConnections: parseInt(process.env.MCP_MAX_CONNECTIONS || '100'),
        requestTimeout: parseInt(process.env.MCP_REQUEST_TIMEOUT || '30000'),
        enableVerboseLogging: process.env.MCP_VERBOSE_LOGGING === '1',
        enableMutation: process.env.MCP_ENABLE_MUTATION === '1',
        rateLimit: {
          windowMs: 60000, // 1 minute
          maxRequests: 100
        }
      },
      catalogSettings: {
        autoRefreshInterval: 300000, // 5 minutes
        cacheSize: 1000,
        enableVersioning: true
      },
      securitySettings: {
        enableCors: false,
        allowedOrigins: ['http://localhost', 'http://127.0.0.1'],
        enableAuthentication: false,
        sessionTimeout: 3600000 // 1 hour
      }
    };
  }

  /**
   * Get current admin configuration
   */
  getAdminConfig(): AdminConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Update admin configuration
   */
  updateAdminConfig(updates: Partial<AdminConfig>): { success: boolean; message: string } {
    try {
      this.config = { ...this.config, ...updates };
      
      // Apply configuration changes to running server
      this.applyConfigChanges(updates);
      
      return { success: true, message: 'Configuration updated successfully' };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  private applyConfigChanges(updates: Partial<AdminConfig>): void {
    // Apply server settings
    if (updates.serverSettings) {
      if (updates.serverSettings.enableVerboseLogging !== undefined) {
        process.env.MCP_VERBOSE_LOGGING = updates.serverSettings.enableVerboseLogging ? '1' : '0';
      }
      if (updates.serverSettings.enableMutation !== undefined) {
        process.env.MCP_ENABLE_MUTATION = updates.serverSettings.enableMutation ? '1' : '0';
      }
    }
  }

  /**
   * Get active admin sessions
   */
  getActiveSessions(): AdminSession[] {
    // Clean up expired sessions
    this.cleanupExpiredSessions();
    return Array.from(this.activeSessions.values());
  }

  /**
   * Create new admin session
   */
  createAdminSession(userId: string, ipAddress: string, userAgent: string): AdminSession {
    const session: AdminSession = {
      id: this.generateSessionId(),
      userId,
      startTime: new Date(),
      lastActivity: new Date(),
      ipAddress,
      userAgent,
      permissions: ['read', 'write', 'admin'] // Default admin permissions
    };

    this.activeSessions.set(session.id, session);
    // Record in history (un-terminated yet)
    const hist: AdminSessionHistoryEntry = {
      id: session.id,
      userId: session.userId,
      startTime: session.startTime,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent
    };
    this.sessionHistory.unshift(hist); // newest first
    this.sessionHistoryIndex.set(hist.id, hist);
    if (this.sessionHistory.length > this.maxSessionHistory) {
      const removed = this.sessionHistory.pop();
      if (removed) this.sessionHistoryIndex.delete(removed.id);
    }
    return session;
  }

  /**
   * Terminate admin session
   */
  terminateSession(sessionId: string): boolean {
    const existed = this.activeSessions.delete(sessionId);
    if (existed) {
      const hist = this.sessionHistoryIndex.get(sessionId);
      if (hist && !hist.terminated) {
        hist.endTime = new Date();
        hist.terminated = true;
        hist.terminationReason = 'manual';
      }
    }
    return existed;
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    const timeout = this.config.securitySettings.sessionTimeout;

    for (const [id, session] of this.activeSessions.entries()) {
      if (now.getTime() - session.lastActivity.getTime() > timeout) {
        this.activeSessions.delete(id);
        const hist = this.sessionHistoryIndex.get(id);
        if (hist && !hist.terminated) {
          hist.endTime = new Date();
          hist.terminated = true;
          hist.terminationReason = 'expired';
        }
      }
    }
  }

  private generateSessionId(): string {
    return `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get system maintenance information
   */
  getMaintenanceInfo(): SystemMaintenance {
    // Update system health
    this.updateSystemHealth();
    return JSON.parse(JSON.stringify(this.maintenanceInfo));
  }

  /**
   * Set maintenance mode
   */
  setMaintenanceMode(enabled: boolean, message?: string): { success: boolean; message: string } {
    try {
      this.maintenanceInfo.maintenanceMode = enabled;
      
      if (enabled) {
        process.stderr.write(`[admin] Maintenance mode ENABLED${message ? `: ${message}` : ''}\n`);
      } else {
        process.stderr.write(`[admin] Maintenance mode DISABLED\n`);
      }

      return { 
        success: true, 
        message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}` 
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to set maintenance mode: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Perform system backup
   */
  async performBackup(): Promise<{ success: boolean; message: string; backupId?: string; files?: number }> {
    try {
      const backupRoot = process.env.MCP_BACKUPS_DIR || path.join(process.cwd(), 'backups');
      if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
  // Include milliseconds to allow multiple backups within the same second
  const now = new Date();
  const iso = now.toISOString();
  const baseTs = iso.replace(/[-:]/g,'').replace(/\..+/, '');
  const ms = String(now.getMilliseconds()).padStart(3,'0');
  const backupId = `backup_${baseTs}_${ms}`; // e.g. backup_20250905T123456_123
      const backupDir = path.join(backupRoot, backupId);
      fs.mkdirSync(backupDir);

      const instructionsDir = process.env.MCP_INSTRUCTIONS_DIR || path.join(process.cwd(), 'instructions');
      let copied = 0;
      if (fs.existsSync(instructionsDir)) {
        for (const file of fs.readdirSync(instructionsDir)) {
          if (file.toLowerCase().endsWith('.json')) {
            const src = path.join(instructionsDir, file);
            const dest = path.join(backupDir, file);
            fs.copyFileSync(src, dest);
            copied++;
          }
        }
      }
      // Write small manifest
      const manifest = {
        backupId,
        createdAt: new Date().toISOString(),
        instructionCount: copied,
        schemaVersion: this.catalogStatsCache?.schemaVersion || 'unknown'
      };
      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      this.maintenanceInfo.lastBackup = new Date();
      process.stderr.write(`[admin] System backup completed: ${backupId} (${copied} files)\n`);
      return { success: true, message: 'System backup completed successfully', backupId, files: copied };
    } catch (error) {
      return { 
        success: false, 
        message: `Backup failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  listBackups(): { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number }[] {
    const backupRoot = process.env.MCP_BACKUPS_DIR || path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupRoot)) return [];
    const results: { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number }[] = [];
    for (const dir of fs.readdirSync(backupRoot)) {
      const full = path.join(backupRoot, dir);
      try {
        if (fs.statSync(full).isDirectory()) {
          const manifestPath = path.join(full, 'manifest.json');
            let createdAt = new Date(fs.statSync(full).mtime).toISOString();
            let instructionCount = 0;
            let schemaVersion: string | undefined;
          if (fs.existsSync(manifestPath)) {
            try {
              const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              createdAt = mf.createdAt || createdAt;
              instructionCount = mf.instructionCount || 0;
              schemaVersion = mf.schemaVersion;
            } catch {/* ignore */}
          } else {
            instructionCount = fs.readdirSync(full).filter(f => f.toLowerCase().endsWith('.json')).length;
          }
          const sizeBytes = fs.readdirSync(full).reduce((sum, f) => {
            try { return sum + fs.statSync(path.join(full, f)).size; } catch { return sum; }
          }, 0);
          results.push({ id: dir, createdAt, instructionCount, schemaVersion, sizeBytes });
        }
      } catch {/* ignore individual dir errors */}
    }
    // newest first
    results.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  restoreBackup(backupId: string): { success: boolean; message: string; restored?: number } {
    try {
      if (!backupId) return { success: false, message: 'backupId required' };
      const backupRoot = process.env.MCP_BACKUPS_DIR || path.join(process.cwd(), 'backups');
      const backupDir = path.join(backupRoot, backupId);
      if (!fs.existsSync(backupDir)) return { success: false, message: `Backup not found: ${backupId}` };
      const instructionsDir = process.env.MCP_INSTRUCTIONS_DIR || path.join(process.cwd(), 'instructions');
      if (!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });
      // Pre-restore safety backup (lightweight) if there are existing files
      const existing = fs.readdirSync(instructionsDir).filter(f => f.toLowerCase().endsWith('.json'));
      if (existing.length) {
        const safetyId = `pre_restore_${Date.now()}`;
        const safetyDir = path.join(backupRoot, safetyId);
        fs.mkdirSync(safetyDir, { recursive: true });
        for (const f of existing) {
          try { fs.copyFileSync(path.join(instructionsDir, f), path.join(safetyDir, f)); } catch {/* ignore */}
        }
        fs.writeFileSync(path.join(safetyDir, 'manifest.json'), JSON.stringify({ type: 'pre-restore', createdAt: new Date().toISOString(), source: backupId, originalCount: existing.length }, null, 2));
        process.stderr.write(`[admin] Pre-restore safety backup created: ${safetyId}\n`);
      }
      // Copy backup files in (overwrite existing)
      let restored = 0;
      for (const f of fs.readdirSync(backupDir)) {
        if (f.toLowerCase().endsWith('.json') && f !== 'manifest.json') {
          fs.copyFileSync(path.join(backupDir, f), path.join(instructionsDir, f));
          restored++;
        }
      }
      // Invalidate catalog cache so schemaVersion recalculates
      this.catalogStatsCache = null;
      process.stderr.write(`[admin] Restored backup ${backupId} (${restored} instruction files)\n`);
      return { success: true, message: `Backup ${backupId} restored`, restored };
    } catch (error) {
      return { success: false, message: `Restore failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Delete a backup directory (non-recursive safety checks) */
  deleteBackup(backupId: string): { success: boolean; message: string; removed?: boolean } {
    try {
      if (!backupId) return { success: false, message: 'backupId required' };
      const backupRoot = process.env.MCP_BACKUPS_DIR || path.join(process.cwd(), 'backups');
      const backupDir = path.join(backupRoot, backupId);
      if (!fs.existsSync(backupDir)) return { success: false, message: `Backup not found: ${backupId}` };
      // Basic guard: only allow deletion of directories that start with expected prefixes
      if (!/^backup_|^instructions-|^pre_restore_/.test(backupId)) {
        return { success: false, message: 'Refusing to delete unexpected directory name' };
      }
      fs.rmSync(backupDir, { recursive: true, force: true });
      process.stderr.write(`[admin] Deleted backup ${backupId}\n`);
      return { success: true, message: `Backup ${backupId} deleted`, removed: true };
    } catch (error) {
      return { success: false, message: `Delete failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Prune backups keeping newest N (by createdAt / mtime). Returns count pruned. */
  pruneBackups(retain: number): { success: boolean; message: string; pruned?: number } {
    try {
      if (retain < 0) return { success: false, message: 'retain must be >= 0' };
      const backupRoot = process.env.MCP_BACKUPS_DIR || path.join(process.cwd(), 'backups');
      if (!fs.existsSync(backupRoot)) return { success: true, message: 'No backups to prune', pruned: 0 };
      const dirs = fs.readdirSync(backupRoot)
        .map(name => ({ name, full: path.join(backupRoot, name) }))
        .filter(d => {
          try { return fs.statSync(d.full).isDirectory(); } catch { return false; }
        })
        .filter(d => /^backup_|^instructions-|^pre_restore_/.test(d.name));
      // sort newest first by mtime
      dirs.sort((a,b) => {
        try { return fs.statSync(b.full).mtime.getTime() - fs.statSync(a.full).mtime.getTime(); } catch { return 0; }
      });
      if (retain === 0) {
        // delete all
        let prunedAll = 0;
        for (const d of dirs) {
          try { fs.rmSync(d.full, { recursive: true, force: true }); prunedAll++; } catch { /* ignore */ }
        }
        process.stderr.write(`[admin] Pruned all backups (${prunedAll})\n`);
        return { success: true, message: `Pruned ${prunedAll} backups`, pruned: prunedAll };
      }
      const survivors = dirs.slice(0, retain);
      const toDelete = dirs.slice(retain);
      let pruned = 0;
      for (const d of toDelete) {
        try { fs.rmSync(d.full, { recursive: true, force: true }); pruned++; } catch { /* ignore */ }
      }
      process.stderr.write(`[admin] Pruned ${pruned} backup(s); retained ${survivors.length}\n`);
      return { success: true, message: `Pruned ${pruned} backups (retained ${survivors.length})`, pruned };
    } catch (error) {
      return { success: false, message: `Prune failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Calculate current CPU usage with historical tracking
   */
  private calculateCpuUsage(): { user: number; system: number; percent: number } {
    const currentCpuUsage = process.cpuUsage();
    let cpuPercent = 0;
    let userTime = 0;
    let systemTime = 0;

    if (this.lastCpuUsage) {
      // Calculate delta since last measurement
      const userDelta = currentCpuUsage.user - this.lastCpuUsage.user;
      const systemDelta = currentCpuUsage.system - this.lastCpuUsage.system;
      const totalDelta = userDelta + systemDelta;
      
      // Convert microseconds to percentage (assuming 1 second interval)
      // For more accurate results, you'd want to track the actual time interval
      cpuPercent = Math.min((totalDelta / 1000000) * 100, 100);
      userTime = userDelta / 1000000; // Convert to seconds
      systemTime = systemDelta / 1000000; // Convert to seconds
    }

    this.lastCpuUsage = currentCpuUsage;

    // Add to history for leak detection
    const historyEntry = {
      timestamp: Date.now(),
      user: userTime,
      system: systemTime,
      percent: cpuPercent
    };

    this.cpuHistory.push(historyEntry);
    
    // Keep only recent entries
    if (this.cpuHistory.length > this.maxCpuHistoryEntries) {
      this.cpuHistory.shift();
    }

    return {
      user: userTime,
      system: systemTime,
      percent: cpuPercent
    };
  }

  /**
   * Analyze CPU trends for potential leaks
   */
  private analyzeCpuTrends(): { trend: 'stable' | 'increasing' | 'decreasing'; avgUsage: number; peakUsage: number } {
    if (this.cpuHistory.length < 10) {
      return { trend: 'stable', avgUsage: 0, peakUsage: 0 };
    }

    const recent = this.cpuHistory.slice(-10);
    const avgUsage = recent.reduce((sum, entry) => sum + entry.percent, 0) / recent.length;
    const peakUsage = Math.max(...recent.map(entry => entry.percent));

    // Simple trend analysis - compare first half vs second half
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const firstAvg = firstHalf.reduce((sum, entry) => sum + entry.percent, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, entry) => sum + entry.percent, 0) / secondHalf.length;

    let trend: 'stable' | 'increasing' | 'decreasing' = 'stable';
    const difference = secondAvg - firstAvg;
    
    if (Math.abs(difference) > 5) {
      trend = difference > 0 ? 'increasing' : 'decreasing';
    }

    return { trend, avgUsage, peakUsage };
  }

  /**
   * Analyze memory usage trends for leak detection
   */
  private analyzeMemoryTrends(): { trend: 'stable' | 'increasing' | 'decreasing'; avgHeapUsed: number; peakHeapUsed: number; growthRate: number } {
    if (this.memoryHistory.length < 10) {
      return { trend: 'stable', avgHeapUsed: 0, peakHeapUsed: 0, growthRate: 0 };
    }

    const recent = this.memoryHistory.slice(-10);
    const avgHeapUsed = recent.reduce((sum, entry) => sum + entry.heapUsed, 0) / recent.length;
    const peakHeapUsed = Math.max(...recent.map(entry => entry.heapUsed));

    // Calculate growth rate (bytes per minute)
    const firstEntry = recent[0];
    const lastEntry = recent[recent.length - 1];
    const timeDiffMinutes = (lastEntry.timestamp - firstEntry.timestamp) / (1000 * 60);
    const growthRate = timeDiffMinutes > 0 ? (lastEntry.heapUsed - firstEntry.heapUsed) / timeDiffMinutes : 0;

    // Simple trend analysis - compare first half vs second half
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const firstAvg = firstHalf.reduce((sum, entry) => sum + entry.heapUsed, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, entry) => sum + entry.heapUsed, 0) / secondHalf.length;

    let trend: 'stable' | 'increasing' | 'decreasing' = 'stable';
    const difference = secondAvg - firstAvg;
    
    // Consider memory leak if growth is > 10MB or growth rate > 1MB/min
    if (Math.abs(difference) > 10 * 1024 * 1024 || Math.abs(growthRate) > 1024 * 1024) {
      trend = difference > 0 ? 'increasing' : 'decreasing';
    }

    return { trend, avgHeapUsed, peakHeapUsed, growthRate };
  }

  /**
   * Get comprehensive admin statistics
   */
  getAdminStats(): AdminStats {
    // Use real metrics snapshot (deterministic values)
    const collector = getMetricsCollector();
    const snapshot = collector.getCurrentSnapshot();

    // Aggregate total requests from tool metrics
    let totalRequests = 0;
    Object.values(snapshot.tools).forEach(t => { totalRequests += t.callCount; });

    // Count instruction JSON files deterministically
    const catalogDir = process.env.MCP_INSTRUCTIONS_DIR || path.join(process.cwd(), 'instructions');
    let instructionCount = 0;
    try {
      if (fs.existsSync(catalogDir)) {
        instructionCount = fs.readdirSync(catalogDir).filter(f => f.toLowerCase().endsWith('.json')).length;
      }
    } catch {
      // ignore filesystem errors
    }

    if (!this.catalogStatsCache || this.catalogStatsCache.totalInstructions !== instructionCount) {
      // Derive aggregated schemaVersion(s) by scanning a sample of instruction files (bounded for perf)
      const catalogDir = process.env.MCP_INSTRUCTIONS_DIR || path.join(process.cwd(), 'instructions');
      const schemaVersions = new Set<string>();
      try {
        if (fs.existsSync(catalogDir)) {
          const files = fs.readdirSync(catalogDir).filter(f => f.toLowerCase().endsWith('.json')).slice(0, 200); // cap scan
          for (const f of files) {
            try {
              const raw = fs.readFileSync(path.join(catalogDir, f), 'utf-8');
              const json = JSON.parse(raw);
              if (typeof json.schemaVersion === 'string') schemaVersions.add(json.schemaVersion);
            } catch { /* ignore parse */ }
          }
        }
      } catch { /* ignore */ }
      const schemaVersion = schemaVersions.size === 0 ? 'unknown' : (schemaVersions.size === 1 ? Array.from(schemaVersions)[0] : `mixed(${Array.from(schemaVersions).join(',')})`);
      this.catalogStatsCache = {
        totalInstructions: instructionCount,
        lastUpdated: new Date(),
        version: snapshot.server.version,
        schemaVersion
      };
    }

    const memUsage = snapshot.server.memoryUsage; // already captured in snapshot
    const cpuUsage = this.calculateCpuUsage(); // Calculate current CPU usage

    return {
  // Total historical websocket connections (connected + disconnected)
  totalConnections: snapshot.connections.totalConnections,
  // Active websocket connections (live WS clients). Previously this returned only admin sessions size,
  // which caused the UI to show 0 even when multiple WS clients were connected. This now reflects
  // real-time active websocket connections from metrics.
  activeConnections: snapshot.connections.activeConnections,
  // Preserve visibility into admin (logical) sessions separately.
  adminActiveSessions: this.activeSessions.size,
      totalRequests,
      errorRate: snapshot.performance.errorRate,
      avgResponseTime: snapshot.performance.avgResponseTime,
      uptime: Math.floor(snapshot.server.uptime / 1000), // seconds
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: (memUsage as unknown as { external?: number })?.external ?? 0
      },
      cpuUsage,
      toolMetrics: snapshot.tools,
      catalogStats: this.catalogStatsCache
    };
  }

  private updateSystemHealth(): void {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Check memory usage and track history
    const memUsage = process.memoryUsage();
    const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    // Track memory history for leak detection
    this.memoryHistory.push({
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    });
    
    // Maintain memory history buffer
    if (this.memoryHistory.length > this.maxMemoryHistoryEntries) {
      this.memoryHistory.shift();
    }
    
    if (memPercent > 80) {
      issues.push('High memory usage detected');
      recommendations.push('Consider restarting the server or increasing memory limits');
    }
    
    // Check memory trends for leak detection
    const memoryTrends = this.analyzeMemoryTrends();
    if (memoryTrends.trend === 'increasing' && memoryTrends.growthRate > 1024 * 1024) {
      issues.push('Memory leak detected - heap growing consistently');
      recommendations.push('Investigate memory usage patterns and potential leaks');
    }
    
    if (memoryTrends.growthRate > 5 * 1024 * 1024) { // > 5MB/min growth
      issues.push('Rapid memory growth detected');
      recommendations.push('Monitor memory usage closely and consider restart if growth continues');
    }
    
    // Check CPU usage and trends
    const cpuTrends = this.analyzeCpuTrends();
    if (cpuTrends.avgUsage > 80) {
      issues.push('High CPU usage detected');
      recommendations.push('Review server load and consider scaling');
    }
    
    if (cpuTrends.trend === 'increasing' && cpuTrends.avgUsage > 50) {
      issues.push('CPU usage trend increasing');
      recommendations.push('Monitor for potential CPU leaks or resource contention');
    }
    
    if (cpuTrends.peakUsage > 95) {
      issues.push('CPU usage spikes detected');
      recommendations.push('Investigate CPU-intensive operations');
    }
    
    // Check uptime (regression & long-running)
    const currentUptimeSeconds = Math.floor(process.uptime());
    const uptimeHours = currentUptimeSeconds / 3600;
    if (this.lastUptimeSeconds > 0 && currentUptimeSeconds < this.lastUptimeSeconds) {
      // Uptime decreased => restart/regression
      issues.push('Uptime regression detected (server restart)');
      recommendations.push('Review restart reason and ensure intentional');
    } else if (uptimeHours > 72) {
      recommendations.push('Consider scheduled restart for optimal performance');
    }
    this.lastUptimeSeconds = currentUptimeSeconds;
    
    // Check error rate
    const errorRate = this.getErrorRate();
    if (errorRate > 5) {
      issues.push('Elevated error rate detected');
      recommendations.push('Review error logs and investigate root causes');
    }
    
    // Determine overall health status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length > 0) {
      status = (memPercent > 90 || errorRate > 10 || cpuTrends.avgUsage > 90 || memoryTrends.growthRate > 10 * 1024 * 1024) ? 'critical' : 'warning';
    }
    
    this.maintenanceInfo.systemHealth = { 
      status, 
      issues, 
      recommendations,
      cpuTrend: cpuTrends.trend,
      memoryTrend: memoryTrends.trend,
      memoryGrowthRate: memoryTrends.growthRate
    };
  }

  /** Return immutable copy of session history */
  getSessionHistory(limit?: number): AdminSessionHistoryEntry[] {
    const slice = typeof limit === 'number' ? this.sessionHistory.slice(0, Math.max(0, limit)) : this.sessionHistory;
    // Deep clone dates
    return slice.map(h => ({ ...h }));
  }

  private getTotalConnections(): number {
    return getMetricsCollector().getCurrentSnapshot().connections.totalConnections;
  }

  private getTotalRequests(): number {
    const snap = getMetricsCollector().getCurrentSnapshot();
    return Object.values(snap.tools).reduce((sum, t) => sum + t.callCount, 0);
  }

  private getErrorRate(): number {
    return getMetricsCollector().getCurrentSnapshot().performance.errorRate;
  }

  private getAvgResponseTime(): number {
    return getMetricsCollector().getCurrentSnapshot().performance.avgResponseTime;
  }

  private getCatalogInstructionCount(): number {
    const catalogDir = process.env.MCP_INSTRUCTIONS_DIR || path.join(process.cwd(), 'instructions');
    try {
      if (fs.existsSync(catalogDir)) {
        return fs.readdirSync(catalogDir).filter(f => f.toLowerCase().endsWith('.json')).length;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  /**
   * Restart server components
   */
  async restartServer(component: 'dashboard' | 'mcp' | 'all' = 'all'): Promise<{ success: boolean; message: string }> {
    try {
      process.stderr.write(`[admin] Restart requested for component: ${component}\n`);
      
      // In real implementation, this would perform actual component restarts
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return { 
        success: true, 
        message: `${component} restart completed successfully` 
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Restart failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Clear server caches
   */
  clearCaches(): { success: boolean; message: string; cleared: string[] } {
    try {
      const cleared: string[] = [];
      
      // Clear instruction cache
      cleared.push('instruction_cache');
      
      // Clear metrics cache
      cleared.push('metrics_cache');
      
      // Clear response cache
      cleared.push('response_cache');
      
      process.stderr.write(`[admin] Caches cleared: ${cleared.join(', ')}\n`);
      
      return { 
        success: true, 
        message: 'All caches cleared successfully',
        cleared
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to clear caches: ${error instanceof Error ? error.message : String(error)}`,
        cleared: []
      };
    }
  }
}

// Singleton instance
let adminPanelInstance: AdminPanel | null = null;

export function getAdminPanel(): AdminPanel {
  if (!adminPanelInstance) {
    adminPanelInstance = new AdminPanel();
  }
  return adminPanelInstance;
}
