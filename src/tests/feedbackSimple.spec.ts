import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getHandler } from '../server/registry';
import fs from 'fs';
import path from 'path';

// Import the feedback handlers to register them
import '../services/handlers.feedback';

// Test feedback directory
const TEST_FEEDBACK_DIR = path.join(process.cwd(), 'tmp', 'test-feedback-simple');
const originalEnv = process.env.FEEDBACK_DIR;

describe('Feedback System - Basic Tests', () => {
  beforeEach(() => {
    process.env.FEEDBACK_DIR = TEST_FEEDBACK_DIR;
    if (fs.existsSync(TEST_FEEDBACK_DIR)) {
      fs.rmSync(TEST_FEEDBACK_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_FEEDBACK_DIR, { recursive: true });
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.FEEDBACK_DIR = originalEnv;
    } else {
      delete process.env.FEEDBACK_DIR;
    }
    if (fs.existsSync(TEST_FEEDBACK_DIR)) {
      fs.rmSync(TEST_FEEDBACK_DIR, { recursive: true, force: true });
    }
  });

  it('all feedback handlers are registered', () => {
    expect(getHandler('feedback/submit')).toBeTruthy();
    expect(getHandler('feedback/list')).toBeTruthy();
    expect(getHandler('feedback/get')).toBeTruthy();
    expect(getHandler('feedback/update')).toBeTruthy();
    expect(getHandler('feedback/stats')).toBeTruthy();
    expect(getHandler('feedback/health')).toBeTruthy();
  });

  it('feedback/health works', async () => {
    const handler = getHandler('feedback/health')!;
    const result = await handler({});
    expect(result).toBeTruthy();
    expect((result as { status: string }).status).toBe('ok');
  });

  it('feedback/submit works with valid input', async () => {
    const handler = getHandler('feedback/submit')!;
    const result = await handler({
      type: 'issue',
      severity: 'medium',
      title: 'Test',
      description: 'Test description'
    });
    expect(result).toBeTruthy();
    expect((result as { success: boolean }).success).toBe(true);
  });

  it('feedback/list works', async () => {
    const handler = getHandler('feedback/list')!;
    const result = await handler({});
    expect(result).toBeTruthy();
    expect((result as { entries: unknown[] }).entries).toEqual([]);
  });
});
