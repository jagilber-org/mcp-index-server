/**
 * SessionPersistenceManager
 * 
 * Manages persistent storage of admin sessions, websocket connections, and session history
 * with deduplication, atomic writes, and backup integration.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  SessionPersistenceConfig,
  SessionPersistenceData,
  SessionPersistenceManifest,
  PersistedAdminSession,
  PersistedWebSocketConnection,
  PersistedSessionHistoryEntry,
  SESSION_PERSISTENCE_FILES,
  DEFAULT_SESSION_PERSISTENCE_CONFIG,
  SESSION_PERSISTENCE_ENV_VARS
} from '../../models/SessionPersistence.js';

export class SessionPersistenceManager {
  private config: SessionPersistenceConfig;
  private persistenceTimer: NodeJS.Timeout | null = null;
  private lastPersistedData: SessionPersistenceData | null = null;
  private isShuttingDown = false;

  constructor(config?: Partial<SessionPersistenceConfig>) {
    this.config = { ...DEFAULT_SESSION_PERSISTENCE_CONFIG, ...config };
    this.loadConfigFromEnvironment();
    
    if (this.config.enabled) {
      this.setupPeriodicPersistence();
      this.setupShutdownHandler();
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfigFromEnvironment(): void {
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.ENABLED] !== undefined) {
      this.config.enabled = process.env[SESSION_PERSISTENCE_ENV_VARS.ENABLED] === 'true';
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.PERSISTENCE_DIR]) {
      this.config.persistenceDir = process.env[SESSION_PERSISTENCE_ENV_VARS.PERSISTENCE_DIR]!;
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.BACKUP_INTEGRATION] !== undefined) {
      this.config.backupIntegration = process.env[SESSION_PERSISTENCE_ENV_VARS.BACKUP_INTEGRATION] === 'true';
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.MAX_HISTORY_ENTRIES]) {
      this.config.retention.maxHistoryEntries = parseInt(process.env[SESSION_PERSISTENCE_ENV_VARS.MAX_HISTORY_ENTRIES]!, 10);
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.MAX_HISTORY_DAYS]) {
      this.config.retention.maxHistoryDays = parseInt(process.env[SESSION_PERSISTENCE_ENV_VARS.MAX_HISTORY_DAYS]!, 10);
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.MAX_CONNECTION_HISTORY_DAYS]) {
      this.config.retention.maxConnectionHistoryDays = parseInt(process.env[SESSION_PERSISTENCE_ENV_VARS.MAX_CONNECTION_HISTORY_DAYS]!, 10);
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.PERSISTENCE_INTERVAL_MS]) {
      this.config.persistence.intervalMs = parseInt(process.env[SESSION_PERSISTENCE_ENV_VARS.PERSISTENCE_INTERVAL_MS]!, 10);
    }
    
    if (process.env[SESSION_PERSISTENCE_ENV_VARS.DEDUPLICATION_ENABLED] !== undefined) {
      this.config.deduplication.enabled = process.env[SESSION_PERSISTENCE_ENV_VARS.DEDUPLICATION_ENABLED] === 'true';
    }
  }

  /**
   * Setup periodic persistence timer
   */
  private setupPeriodicPersistence(): void {
    if (this.config.persistence.intervalMs > 0) {
      this.persistenceTimer = setInterval(() => {
        if (!this.isShuttingDown) {
          this.persistCurrentState().catch(err => {
            console.error('[SessionPersistence] Periodic persistence failed:', err);
          });
        }
      }, this.config.persistence.intervalMs);
    }
  }

  /**
   * Setup graceful shutdown handler
   */
  private setupShutdownHandler(): void {
    if (this.config.persistence.onShutdown) {
      const gracefulShutdown = async () => {
        if (!this.isShuttingDown) {
          this.isShuttingDown = true;
          console.log('[SessionPersistence] Graceful shutdown initiated...');
          
          // Clear periodic timer
          if (this.persistenceTimer) {
            clearInterval(this.persistenceTimer);
            this.persistenceTimer = null;
          }
          
          // Final persistence
          try {
            await this.persistCurrentState();
            console.log('[SessionPersistence] Final state persisted successfully');
          } catch (err) {
            console.error('[SessionPersistence] Final persistence failed:', err);
          }
        }
      };

      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
      process.on('beforeExit', gracefulShutdown);
    }
  }

  /**
   * Calculate checksum for deduplication
   */
  private calculateChecksum(data: string): string {
    return createHash(this.config.deduplication.checksumAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Check if data has changed since last persistence
   */
  private hasDataChanged(data: SessionPersistenceData): boolean {
    if (!this.config.deduplication.enabled || !this.lastPersistedData) {
      return true;
    }

    const currentChecksums = {
      sessions: this.calculateChecksum(JSON.stringify(data.adminSessions.map((s: PersistedAdminSession) => s.id).sort())),
      connections: this.calculateChecksum(JSON.stringify(data.webSocketConnections.map((c: PersistedWebSocketConnection) => c.id).sort())),
      history: this.calculateChecksum(JSON.stringify(data.sessionHistory.map((h: PersistedSessionHistoryEntry) => h.id).sort()))
    };

    const lastChecksums = this.lastPersistedData.metadata.checksums;

    return (
      currentChecksums.sessions !== lastChecksums.sessions ||
      currentChecksums.connections !== lastChecksums.connections ||
      currentChecksums.history !== lastChecksums.history
    );
  }

  /**
   * Ensure persistence directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const sessionsDir = join(this.config.persistenceDir, 'sessions');
    const backupsDir = join(this.config.persistenceDir, 'backups');
    
    await fs.mkdir(sessionsDir, { recursive: true });
    if (this.config.backupIntegration) {
      await fs.mkdir(backupsDir, { recursive: true });
    }
  }

  /**
   * Atomic file write with backup
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    if (!this.config.atomicWrites.enabled) {
      await fs.writeFile(filePath, content, 'utf8');
      return;
    }

    const tempPath = filePath + this.config.atomicWrites.tempSuffix;
    const backupPath = filePath + this.config.atomicWrites.backupSuffix;

    try {
      // Write to temporary file
      await fs.writeFile(tempPath, content, 'utf8');
      
      // Backup existing file if it exists
      try {
        await fs.access(filePath);
        await fs.copyFile(filePath, backupPath);
      } catch {
        // File doesn't exist, no backup needed
      }
      
      // Atomic move
      await fs.rename(tempPath, filePath);
      
      // Remove backup if successful
      try {
        await fs.unlink(backupPath);
      } catch {
        // Backup removal failure is not critical
      }
      
    } catch (err) {
      // Cleanup temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Cleanup failure is not critical
      }
      throw err;
    }
  }

  /**
   * Apply retention policies to data
   */
  private applyRetentionPolicies(data: SessionPersistenceData): SessionPersistenceData {
    const now = new Date();
    const maxHistoryDate = new Date(now.getTime() - (this.config.retention.maxHistoryDays * 24 * 60 * 60 * 1000));
    const maxConnectionDate = new Date(now.getTime() - (this.config.retention.maxConnectionHistoryDays * 24 * 60 * 60 * 1000));

    // Filter session history by date and count
    const filteredHistory = data.sessionHistory
      .filter(entry => {
        const entryDate = new Date(entry.startTime);
        return entryDate >= maxHistoryDate;
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, this.config.retention.maxHistoryEntries);

    // Filter connection history by date
    const filteredConnections = data.webSocketConnections
      .filter(conn => {
        const connDate = new Date(conn.connectedAt);
        return connDate >= maxConnectionDate;
      });

    return {
      ...data,
      sessionHistory: filteredHistory,
      webSocketConnections: filteredConnections
    };
  }

  /**
   * Create backup of current persistence data
   */
  private async createBackup(data: SessionPersistenceData): Promise<void> {
    if (!this.config.backupIntegration) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.config.persistenceDir, 'backups', timestamp);
    
    await fs.mkdir(backupDir, { recursive: true });

    const backupFiles = [
      { name: SESSION_PERSISTENCE_FILES.ADMIN_SESSIONS, data: data.adminSessions },
      { name: SESSION_PERSISTENCE_FILES.WEBSOCKET_CONNECTIONS, data: data.webSocketConnections },
      { name: SESSION_PERSISTENCE_FILES.SESSION_HISTORY, data: data.sessionHistory },
      { name: SESSION_PERSISTENCE_FILES.METADATA, data: data.metadata }
    ];

    for (const file of backupFiles) {
      const backupPath = join(backupDir, file.name);
      await fs.writeFile(backupPath, JSON.stringify(file.data, null, 2), 'utf8');
    }

    // Create manifest
    const manifest: SessionPersistenceManifest = {
      metadata: data.metadata,
      files: {
        adminSessions: SESSION_PERSISTENCE_FILES.ADMIN_SESSIONS,
        webSocketConnections: SESSION_PERSISTENCE_FILES.WEBSOCKET_CONNECTIONS,
        sessionHistory: SESSION_PERSISTENCE_FILES.SESSION_HISTORY
      },
      retention: this.config.retention
    };

    await fs.writeFile(
      join(backupDir, SESSION_PERSISTENCE_FILES.MANIFEST),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
  }

  /**
   * Persist session data to disk
   */
  async persistData(data: SessionPersistenceData): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Check for changes if deduplication is enabled
    if (!this.hasDataChanged(data)) {
      return; // No changes, skip persistence
    }

    // Apply retention policies
    const filteredData = this.applyRetentionPolicies(data);

    // Update metadata
    const now = new Date().toISOString();
    filteredData.metadata = {
      ...filteredData.metadata,
      lastPersisted: now,
      totalSessions: filteredData.adminSessions.length,
      totalConnections: filteredData.webSocketConnections.length,
      totalHistoryEntries: filteredData.sessionHistory.length,
      checksums: {
        sessions: this.calculateChecksum(JSON.stringify(filteredData.adminSessions.map(s => s.id).sort())),
        connections: this.calculateChecksum(JSON.stringify(filteredData.webSocketConnections.map(c => c.id).sort())),
        history: this.calculateChecksum(JSON.stringify(filteredData.sessionHistory.map(h => h.id).sort()))
      }
    };

    try {
      await this.ensureDirectories();

      const sessionsDir = join(this.config.persistenceDir, 'sessions');

      // Create backup before writing new data
      await this.createBackup(filteredData);

      // Write data files
      await this.atomicWrite(
        join(sessionsDir, SESSION_PERSISTENCE_FILES.ADMIN_SESSIONS),
        JSON.stringify(filteredData.adminSessions, null, 2)
      );

      await this.atomicWrite(
        join(sessionsDir, SESSION_PERSISTENCE_FILES.WEBSOCKET_CONNECTIONS),
        JSON.stringify(filteredData.webSocketConnections, null, 2)
      );

      await this.atomicWrite(
        join(sessionsDir, SESSION_PERSISTENCE_FILES.SESSION_HISTORY),
        JSON.stringify(filteredData.sessionHistory, null, 2)
      );

      await this.atomicWrite(
        join(sessionsDir, SESSION_PERSISTENCE_FILES.METADATA),
        JSON.stringify(filteredData.metadata, null, 2)
      );

      // Write manifest
      const manifest: SessionPersistenceManifest = {
        metadata: filteredData.metadata,
        files: {
          adminSessions: SESSION_PERSISTENCE_FILES.ADMIN_SESSIONS,
          webSocketConnections: SESSION_PERSISTENCE_FILES.WEBSOCKET_CONNECTIONS,
          sessionHistory: SESSION_PERSISTENCE_FILES.SESSION_HISTORY
        },
        retention: this.config.retention
      };

      await this.atomicWrite(
        join(sessionsDir, SESSION_PERSISTENCE_FILES.MANIFEST),
        JSON.stringify(manifest, null, 2)
      );

      this.lastPersistedData = filteredData;

    } catch (err) {
      console.error('[SessionPersistence] Failed to persist data:', err);
      throw err;
    }
  }

  /**
   * Load persisted session data from disk
   */
  async loadData(): Promise<SessionPersistenceData | null> {
    if (!this.config.enabled) {
      return null;
    }

    const sessionsDir = join(this.config.persistenceDir, 'sessions');
    const manifestPath = join(sessionsDir, SESSION_PERSISTENCE_FILES.MANIFEST);

    try {
      // Check if manifest exists
      await fs.access(manifestPath);
      
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      const manifest: SessionPersistenceManifest = JSON.parse(manifestContent);

      // Load data files
      const [adminSessions, webSocketConnections, sessionHistory, metadata] = await Promise.all([
        fs.readFile(join(sessionsDir, manifest.files.adminSessions), 'utf8').then(content => JSON.parse(content)),
        fs.readFile(join(sessionsDir, manifest.files.webSocketConnections), 'utf8').then(content => JSON.parse(content)),
        fs.readFile(join(sessionsDir, manifest.files.sessionHistory), 'utf8').then(content => JSON.parse(content)),
        fs.readFile(join(sessionsDir, SESSION_PERSISTENCE_FILES.METADATA), 'utf8').then(content => JSON.parse(content))
      ]);

      const data: SessionPersistenceData = {
        adminSessions,
        webSocketConnections,
        sessionHistory,
        metadata
      };

      this.lastPersistedData = data;
      return data;

    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // No persisted data exists yet
        return null;
      }
      
      console.error('[SessionPersistence] Failed to load data:', err);
      throw err;
    }
  }

  /**
   * Clear all session history (for UI clear history button)
   */
  async clearHistory(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Load current data
    const currentData = await this.loadData();
    if (!currentData) {
      return;
    }

    // Clear history but keep active sessions and connections
    const clearedData: SessionPersistenceData = {
      ...currentData,
      sessionHistory: [],
      metadata: {
        ...currentData.metadata,
        totalHistoryEntries: 0,
        checksums: {
          ...currentData.metadata.checksums,
          history: this.calculateChecksum('[]')
        }
      }
    };

    await this.persistData(clearedData);
  }

  /**
   * Get persistence status and statistics
   */
  getStatus(): {
    enabled: boolean;
    lastPersisted: string | null;
    totalSessions: number;
    totalConnections: number;
    totalHistoryEntries: number;
    config: SessionPersistenceConfig;
  } {
    return {
      enabled: this.config.enabled,
      lastPersisted: this.lastPersistedData?.metadata.lastPersisted || null,
      totalSessions: this.lastPersistedData?.metadata.totalSessions || 0,
      totalConnections: this.lastPersistedData?.metadata.totalConnections || 0,
      totalHistoryEntries: this.lastPersistedData?.metadata.totalHistoryEntries || 0,
      config: this.config
    };
  }

  /**
   * Placeholder for current state persistence (to be implemented by callers)
   */
  async persistCurrentState(): Promise<void> {
    // This method should be overridden or called with actual session data
    // by the AdminPanel and WebSocketManager
    console.warn('[SessionPersistence] persistCurrentState called but not implemented');
  }

  /**
   * Cleanup - stop timers and persist final state
   */
  async cleanup(): Promise<void> {
    this.isShuttingDown = true;
    
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    if (this.config.persistence.onShutdown) {
      await this.persistCurrentState();
    }
  }
}