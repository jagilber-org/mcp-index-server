import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getHandler } from '../server/registry';
import fs from 'fs';
import path from 'path';

// Import the feedback handlers to register them
import '../services/handlers.feedback';

// Test feedback directory
const TEST_FEEDBACK_DIR = path.join(process.cwd(), 'tmp', 'test-feedback');
const originalEnv = process.env.FEEDBACK_DIR;

describe('Feedback System - Core Functionality', () => {
  beforeEach(() => {
    // Set test-specific feedback directory
    process.env.FEEDBACK_DIR = TEST_FEEDBACK_DIR;
    
    // Clean up test directory
    if (fs.existsSync(TEST_FEEDBACK_DIR)) {
      fs.rmSync(TEST_FEEDBACK_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_FEEDBACK_DIR, { recursive: true });
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.FEEDBACK_DIR = originalEnv;
    } else {
      delete process.env.FEEDBACK_DIR;
    }

    // Clean up test directory
    if (fs.existsSync(TEST_FEEDBACK_DIR)) {
      fs.rmSync(TEST_FEEDBACK_DIR, { recursive: true, force: true });
    }
  });

  it('registers feedback handlers correctly', () => {
    expect(getHandler('feedback/submit')).toBeTruthy();
    expect(getHandler('feedback/list')).toBeTruthy();
    expect(getHandler('feedback/get')).toBeTruthy();
    expect(getHandler('feedback/update')).toBeTruthy();
    expect(getHandler('feedback/stats')).toBeTruthy();
    expect(getHandler('feedback/health')).toBeTruthy();
  });

  it('feedback/health returns health status', async () => {
    const handler = getHandler('feedback/health')!;
    const result = await handler({}) as { status: string; timestamp: string; storage: object };
    
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeTruthy();
    expect(result.storage).toBeTruthy();
  });

  it('feedback/submit creates new feedback entry', async () => {
    const handler = getHandler('feedback/submit')!;
    const feedback = {
      type: 'issue',
      severity: 'medium',
      title: 'Test issue',
      description: 'This is a test issue'
    };

    const result = await handler(feedback) as { success: boolean; feedbackId: string };
    
    expect(result.success).toBe(true);
    expect(result.feedbackId).toBeTruthy();
    expect(typeof result.feedbackId).toBe('string');
    expect(result.feedbackId.length).toBe(16);
  });

  it('feedback/submit validates required parameters', async () => {
    const handler = getHandler('feedback/submit')!;
    const incomplete = {
      type: 'issue',
      severity: 'medium'
      // missing title and description
    };

    await expect(handler(incomplete)).rejects.toThrow('Missing required parameters');
  });

  it('feedback/list returns empty list initially', async () => {
    const handler = getHandler('feedback/list')!;
    const result = await handler({}) as { entries: unknown[]; total: number };
    
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('feedback/submit and list work together', async () => {
    const submitHandler = getHandler('feedback/submit')!;
    const listHandler = getHandler('feedback/list')!;

    // Submit feedback
    await submitHandler({
      type: 'issue',
      severity: 'high',
      title: 'Test issue',
      description: 'Test description'
    });

    // List feedback
    const result = await listHandler({}) as { entries: { type: string; severity: string; title: string }[]; total: number };
    
    expect(result.entries.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.entries[0].type).toBe('issue');
    expect(result.entries[0].severity).toBe('high');
    expect(result.entries[0].title).toBe('Test issue');
  });

  it('feedback/get retrieves specific entry', async () => {
    const submitHandler = getHandler('feedback/submit')!;
    const getHandler2 = getHandler('feedback/get')!;

    // Submit feedback
    const submitResult = await submitHandler({
      type: 'bug-report',
      severity: 'low',
      title: 'Bug report',
      description: 'Found a bug'
    }) as { feedbackId: string };

    // Get specific entry
    const result = await getHandler2({ id: submitResult.feedbackId }) as { entry: { id: string; type: string; title: string } };
    
    expect(result.entry.id).toBe(submitResult.feedbackId);
    expect(result.entry.type).toBe('bug-report');
    expect(result.entry.title).toBe('Bug report');
  });

  it('feedback/update modifies entry status', async () => {
    const submitHandler = getHandler('feedback/submit')!;
    const updateHandler = getHandler('feedback/update')!;
    const getHandler2 = getHandler('feedback/get')!;

    // Submit feedback
    const submitResult = await submitHandler({
      type: 'feature-request',
      severity: 'medium',
      title: 'New feature',
      description: 'Would like this feature'
    }) as { feedbackId: string };

    // Update status
    await updateHandler({
      id: submitResult.feedbackId,
      status: 'acknowledged'
    });

    // Verify update
    const result = await getHandler2({ id: submitResult.feedbackId }) as { entry: { status: string } };
    expect(result.entry.status).toBe('acknowledged');
  });

  it('feedback/stats provides statistics', async () => {
    const submitHandler = getHandler('feedback/submit')!;
    const statsHandler = getHandler('feedback/stats')!;

    // Submit various feedback
    await submitHandler({
      type: 'issue',
      severity: 'high',
      title: 'Issue 1',
      description: 'First issue'
    });

    await submitHandler({
      type: 'security',
      severity: 'critical',
      title: 'Security issue',
      description: 'Security problem'
    });

    // Get stats
    const result = await statsHandler({}) as { 
      stats: { 
        total: number; 
        byType: Record<string, number>; 
        bySeverity: Record<string, number> 
      } 
    };
    
    expect(result.stats.total).toBe(2);
    expect(result.stats.byType.issue).toBe(1);
    expect(result.stats.byType.security).toBe(1);
    expect(result.stats.bySeverity.high).toBe(1);
    expect(result.stats.bySeverity.critical).toBe(1);
  });

  it('validates enum values properly', async () => {
    const handler = getHandler('feedback/submit')!;

    // Test invalid type
    await expect(handler({
      type: 'invalid-type',
      severity: 'medium',
      title: 'Test',
      description: 'Test'
    })).rejects.toThrow('Invalid type');

    // Test invalid severity
    await expect(handler({
      type: 'issue',
      severity: 'invalid-severity',
      title: 'Test',
      description: 'Test'
    })).rejects.toThrow('Invalid severity');
  });

  it('persists data to filesystem', async () => {
    const submitHandler = getHandler('feedback/submit')!;
    
    // Submit feedback
    await submitHandler({
      type: 'issue',
      severity: 'medium',
      title: 'Persistence test',
      description: 'Testing data persistence'
    });

    // Check that file was created
    const feedbackFile = path.join(TEST_FEEDBACK_DIR, 'feedback-entries.json');
    expect(fs.existsSync(feedbackFile)).toBe(true);

    // Check file content
    const content = fs.readFileSync(feedbackFile, 'utf8');
    const data = JSON.parse(content);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].title).toBe('Persistence test');
  });
});
