/**
 * Feedback/Emit System for MCP Index Server
 * 
 * Provides MCP protocol-compliant tools for clients to submit structured feedback,
 * status reports, security issues, feature requests, and other communications
 * to server administrators or monitoring systems.
 * 
 * This system follows MCP best practices:
 * - Tools are discoverable via tools/list
 * - Input validation via JSON schemas
 * - Structured responses for programmatic consumption
 * - Proper error handling and logging
 * - Audit trail for security and compliance
 */

import { registerHandler } from '../server/registry';
import { logInfo, logWarn, logError } from './logger';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

interface FeedbackEntry {
  id: string;
  timestamp: string;
  type: 'issue' | 'status' | 'security' | 'feature-request' | 'bug-report' | 'performance' | 'usability' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  context?: {
    clientInfo?: {
      name: string;
      version: string;
    };
    serverVersion?: string;
    environment?: Record<string, string>;
    sessionId?: string;
    toolName?: string;
    requestId?: string;
  };
  metadata?: Record<string, unknown>;
  tags?: string[];
  status: 'new' | 'acknowledged' | 'in-progress' | 'resolved' | 'closed';
}

interface FeedbackStorage {
  entries: FeedbackEntry[];
  lastUpdated: string;
  version: string;
}

// Environment-configurable feedback directory
const FEEDBACK_DIR = process.env.FEEDBACK_DIR || path.join(process.cwd(), 'feedback');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback-entries.json');
const MAX_ENTRIES = parseInt(process.env.FEEDBACK_MAX_ENTRIES || '1000', 10);

// Ensure feedback directory exists
if (!fs.existsSync(FEEDBACK_DIR)) {
  try {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  } catch (error) {
    logError('Failed to create feedback directory', { error, dir: FEEDBACK_DIR });
  }
}

/**
 * Load feedback entries from storage
 */
function loadFeedbackStorage(): FeedbackStorage {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      const content = fs.readFileSync(FEEDBACK_FILE, 'utf8');
      const parsed = JSON.parse(content) as FeedbackStorage;
      
      // Validate structure
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
        throw new Error('Invalid feedback storage format');
      }
      
      return parsed;
    }
  } catch (error) {
    logWarn('Failed to load feedback storage, initializing empty', { error });
  }
  
  return {
    entries: [],
    lastUpdated: new Date().toISOString(),
    version: '1.0.0'
  };
}

/**
 * Save feedback entries to storage
 */
function saveFeedbackStorage(storage: FeedbackStorage): void {
  try {
    // Limit storage size
    if (storage.entries.length > MAX_ENTRIES) {
      // Keep most recent entries
      storage.entries = storage.entries
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, MAX_ENTRIES);
    }
    
    storage.lastUpdated = new Date().toISOString();
    
    const content = JSON.stringify(storage, null, 2);
    fs.writeFileSync(FEEDBACK_FILE, content, 'utf8');
  } catch (error) {
    logError('Failed to save feedback storage', { error });
    throw error;
  }
}

/**
 * Generate unique ID for feedback entry
 */
function generateFeedbackId(type: string, timestamp: string): string {
  const hash = createHash('sha256');
  hash.update(`${type}-${timestamp}-${Math.random()}`);
  return hash.digest('hex').substring(0, 16);
}

/**
 * feedback/submit - Submit new feedback entry
 */
registerHandler('feedback/submit', (params: {
  type: string;
  severity: string;
  title: string;
  description: string;
  context?: FeedbackEntry['context'];
  metadata?: Record<string, unknown>;
  tags?: string[];
}) => {
  // Validate required parameters
  if (!params.type || !params.severity || !params.title || !params.description) {
    throw new Error('Missing required parameters: type, severity, title, description');
  }

  // Validate enum values
  const validTypes = ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'];
  const validSeverities = ['low', 'medium', 'high', 'critical'];

  if (!validTypes.includes(params.type)) {
    throw new Error(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
  }

  if (!validSeverities.includes(params.severity)) {
    throw new Error(`Invalid severity. Must be one of: ${validSeverities.join(', ')}`);
  }

  const timestamp = new Date().toISOString();
  const entry: FeedbackEntry = {
    id: generateFeedbackId(params.type, timestamp),
    timestamp,
    type: params.type as FeedbackEntry['type'],
    severity: params.severity as FeedbackEntry['severity'],
    title: params.title.substring(0, 200), // Limit title length
    description: params.description.substring(0, 2000), // Limit description length
    context: params.context,
    metadata: params.metadata,
    tags: params.tags?.slice(0, 10), // Limit number of tags
    status: 'new'
  };

  const storage = loadFeedbackStorage();
  storage.entries.push(entry);
  saveFeedbackStorage(storage);

  // Log feedback submission for audit trail
  logInfo('Feedback submitted', {
    id: entry.id,
    type: entry.type,
    severity: entry.severity,
    title: entry.title,
    clientInfo: entry.context?.clientInfo
  });

  // For security issues, also log to stderr for immediate visibility
  if (entry.type === 'security' || entry.severity === 'critical') {
    try {
      process.stderr.write(`[SECURITY/CRITICAL] Feedback ID: ${entry.id}, Type: ${entry.type}, Title: ${entry.title}\n`);
    } catch {
      // Ignore stderr write failures
    }
  }

  return {
    success: true,
    feedbackId: entry.id,
    timestamp: entry.timestamp,
    message: 'Feedback submitted successfully'
  };
});

/**
 * feedback/list - List feedback entries with filtering
 */
registerHandler('feedback/list', (params: {
  type?: string;
  severity?: string;
  status?: string;
  limit?: number;
  offset?: number;
  since?: string;
  tags?: string[];
}) => {
  const storage = loadFeedbackStorage();
  let entries = [...storage.entries];

  // Apply filters
  if (params.type) {
    entries = entries.filter(e => e.type === params.type);
  }
  
  if (params.severity) {
    entries = entries.filter(e => e.severity === params.severity);
  }
  
  if (params.status) {
    entries = entries.filter(e => e.status === params.status);
  }
  
  if (params.since) {
    entries = entries.filter(e => e.timestamp >= params.since!);
  }
  
  if (params.tags && params.tags.length > 0) {
    entries = entries.filter(e => 
      e.tags && params.tags!.some(tag => e.tags!.includes(tag))
    );
  }

  // Sort by timestamp (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply pagination
  const limit = Math.min(params.limit || 50, 200); // Max 200 entries per request
  const offset = params.offset || 0;
  
  const paginatedEntries = entries.slice(offset, offset + limit);

  return {
    entries: paginatedEntries,
    total: entries.length,
    limit,
    offset,
    hasMore: offset + limit < entries.length
  };
});

/**
 * feedback/get - Get specific feedback entry by ID
 */
registerHandler('feedback/get', (params: { id: string }) => {
  if (!params.id) {
    throw new Error('Missing required parameter: id');
  }

  const storage = loadFeedbackStorage();
  const entry = storage.entries.find(e => e.id === params.id);

  if (!entry) {
    throw new Error(`Feedback entry not found: ${params.id}`);
  }

  return { entry };
});

/**
 * feedback/update - Update feedback entry status (admin function)
 */
registerHandler('feedback/update', (params: {
  id: string;
  status?: string;
  metadata?: Record<string, unknown>;
}) => {
  if (!params.id) {
    throw new Error('Missing required parameter: id');
  }

  const validStatuses = ['new', 'acknowledged', 'in-progress', 'resolved', 'closed'];
  if (params.status && !validStatuses.includes(params.status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const storage = loadFeedbackStorage();
  const entryIndex = storage.entries.findIndex(e => e.id === params.id);

  if (entryIndex === -1) {
    throw new Error(`Feedback entry not found: ${params.id}`);
  }

  const entry = storage.entries[entryIndex];
  const oldStatus = entry.status;

  // Update fields
  if (params.status) {
    entry.status = params.status as FeedbackEntry['status'];
  }

  if (params.metadata) {
    entry.metadata = { ...entry.metadata, ...params.metadata };
  }

  // Add update timestamp to metadata
  entry.metadata = {
    ...entry.metadata,
    lastUpdated: new Date().toISOString(),
    updatedBy: 'system' // Could be enhanced to track admin user
  };

  storage.entries[entryIndex] = entry;
  saveFeedbackStorage(storage);

  logInfo('Feedback entry updated', {
    id: entry.id,
    oldStatus,
    newStatus: entry.status,
    type: entry.type
  });

  return {
    success: true,
    entry,
    message: 'Feedback entry updated successfully'
  };
});

/**
 * feedback/stats - Get feedback statistics and metrics
 */
registerHandler('feedback/stats', (params: { since?: string }) => {
  const storage = loadFeedbackStorage();
  let entries = storage.entries;

  // Filter by date if specified
  if (params.since) {
    const sinceDate = params.since;
    entries = entries.filter(e => e.timestamp >= sinceDate);
  }

  // Calculate statistics
  const stats = {
    total: entries.length,
    byType: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
    recentActivity: {
      last24h: 0,
      last7d: 0,
      last30d: 0
    }
  };

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  entries.forEach(entry => {
    // Count by type
    stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
    
    // Count by severity
    stats.bySeverity[entry.severity] = (stats.bySeverity[entry.severity] || 0) + 1;
    
    // Count by status
    stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;
    
    // Count recent activity
    const entryTime = new Date(entry.timestamp).getTime();
    const age = now - entryTime;
    
    if (age <= day) stats.recentActivity.last24h++;
    if (age <= 7 * day) stats.recentActivity.last7d++;
    if (age <= 30 * day) stats.recentActivity.last30d++;
  });

  return {
    stats,
    storageInfo: {
      lastUpdated: storage.lastUpdated,
      version: storage.version,
      maxEntries: MAX_ENTRIES
    }
  };
});

/**
 * feedback/health - Health check for feedback system
 */
registerHandler('feedback/health', () => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    storage: {
      accessible: false,
      writable: false,
      directory: FEEDBACK_DIR,
      file: FEEDBACK_FILE
    },
    config: {
      maxEntries: MAX_ENTRIES,
      feedbackDir: FEEDBACK_DIR
    }
  };

  try {
    // Check if storage is accessible
    if (fs.existsSync(FEEDBACK_FILE)) {
      fs.accessSync(FEEDBACK_FILE, fs.constants.R_OK);
      health.storage.accessible = true;
    } else {
      // File doesn't exist but directory should be writable
      health.storage.accessible = fs.existsSync(FEEDBACK_DIR);
    }

    // Check if writable
    fs.accessSync(FEEDBACK_DIR, fs.constants.W_OK);
    health.storage.writable = true;

  } catch (error) {
    health.status = 'degraded';
    logWarn('Feedback system health check failed', { error });
  }

  return health;
});
