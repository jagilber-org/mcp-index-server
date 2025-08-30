import { describe, it, expect } from 'vitest';
import { PromptReviewService, summarizeIssues } from '../services/promptReviewService';

describe('PromptReviewService', () => {
  const svc = new PromptReviewService();
  it('flags missing required tokens', () => {
    const prompt = 'Create something secure';
    const issues = svc.review(prompt);
    const summary = summarizeIssues(issues);
    expect(issues.length).toBeGreaterThan(0);
    expect(summary).toBeTruthy();
  });
  it('detects secrets pattern', () => {
    const prompt = 'Use key AKIAABCDEFGHIJKLMNOP to test';
    const issues = svc.review(prompt);
    expect(issues.some(i => i.ruleId === 'no-secrets')).toBe(true);
  });
});