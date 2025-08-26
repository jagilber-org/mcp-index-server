import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { incrementUsage } from '../services/catalogContext';
import { getCatalogState } from '../services/toolHandlers';
import '../services/toolHandlers';

// helper exported via toolHandlers wrapper
function usageSnapshotPath(){ return path.join(process.cwd(),'data','usage-snapshot.json'); }

describe('firstSeenTs persistence', () => {
  it('sets firstSeenTs on first increment and preserves across subsequent increments & flush', async () => {
    const st = getCatalogState();
    const entry = st.list[0];
    // Clean usage snapshot to force new firstSeenTs
    const snap = usageSnapshotPath();
    if(fs.existsSync(snap)) fs.unlinkSync(snap);
    const r1 = incrementUsage(entry.id)!;
    expect(r1.firstSeenTs).toBeTruthy();
    const first = r1.firstSeenTs!;
    // Second increment should not change firstSeenTs
  const r2 = incrementUsage(entry.id)!;
  expect(r2.firstSeenTs).toBe(first); // must remain stable
    // Wait for flush (usage flush timer 500ms)
  await new Promise(res=> setTimeout(res, 550));
    expect(fs.existsSync(snap)).toBe(true);
  const snapshot = JSON.parse(fs.readFileSync(snap,'utf8')) as Record<string, { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string }>;
    expect(snapshot[entry.id].firstSeenTs).toBe(first);
    expect(snapshot[entry.id].lastUsedAt).toBe(r2.lastUsedAt);
  });
});
