import { describe, it, expect } from 'vitest';
import { getCatalogState } from '../services/toolHandlers';
import crypto from 'crypto';

function integrityVerify(){
  const st = getCatalogState();
  const issues: Array<{ id: string; expected: string; actual: string }> = [];
  for(const entry of st.list){
    const actual = crypto.createHash('sha256').update(entry.body,'utf8').digest('hex');
    if(actual !== entry.sourceHash){
      issues.push({ id: entry.id, expected: entry.sourceHash, actual });
    }
  }
  return { hash: st.hash, count: st.list.length, issues, issueCount: issues.length };
}

describe('integrity/verify', () => {
  it('returns no issues for unmodified in-memory catalog', () => {
    const result = integrityVerify();
    expect(result.issueCount).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.count).toBeGreaterThanOrEqual(0);
  });
});
