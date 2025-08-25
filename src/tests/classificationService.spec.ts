import { describe, it, expect } from 'vitest';
import { ClassificationService } from '../services/classificationService';

describe('ClassificationService', () => {
  const svc = new ClassificationService();
  it('normalizes and computes hash & risk', () => {
    const norm = svc.normalize({
      id: 'instr-1', title: ' Test ', body: 'content', priority: 10,
      audience: 'all', requirement: 'mandatory', categories: ['Security','security'],
      sourceHash: '', schemaVersion: '1', createdAt: '', updatedAt: ''
    });
    expect(norm.title).toBe('Test');
    expect(norm.categories).toEqual(['security']);
    expect(norm.sourceHash).toHaveLength(64);
    expect(norm.riskScore).toBeGreaterThan(0);
  });
  it('validates deprecated rule', () => {
    const issues = svc.validate({
      id:'x', title:'x', body:'b', priority:50, audience:'all', requirement:'deprecated', categories:[], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
    });
    expect(issues).toContain('deprecated requires deprecatedBy');
  });
});
