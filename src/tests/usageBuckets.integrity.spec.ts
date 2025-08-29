import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { UsageBucketsService } from '../services/usageBuckets.js';

// Deterministic time provider helper
class MockClock {
  private _now: number;
  constructor(start: number) { this._now = start; }
  nowDate() { return new Date(this._now); }
  advance(ms: number) { this._now += ms; }
}

describe('UsageBuckets Integrity & Rotation', () => {
  it('rotates buckets when time advances beyond end boundary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-rotate-'));
    const clock = new MockClock(Date.UTC(2025, 0, 1, 0, 5, 0)); // Jan 1 2025 00:05 UTC
    const svc = new UsageBucketsService(dir, { bucketSizeMinutes: 60, bucketCount: 4 }, { timeProvider: () => clock.nowDate() });
    await svc.initialize();

    const initial = svc._debugGetContainer();
    expect(initial).toBeTruthy();
    const firstIndex = initial!.currentBucketIndex;

    // Record usage in current bucket
    await svc.recordUsage({ operation: 'list', success: true });

  // Advance time just before boundary - no rotation expected (invoke recordUsage to run rotate logic)
  clock.advance(54 * 60 * 1000); // to 00:59
  await svc.recordUsage({ operation: 'get', success: true });
    const beforeBoundary = svc._debugGetContainer();
    expect(beforeBoundary!.currentBucketIndex).toBe(firstIndex);

  // Advance past boundary (>= 01:00)
  clock.advance(2 * 60 * 1000); // cross to 01:01
  await svc.recordUsage({ operation: 'get', success: true });
    const afterRotation = svc._debugGetContainer();
    expect(afterRotation!.currentBucketIndex).not.toBe(firstIndex);
    expect(afterRotation!.metrics.rotationCount).toBe(1);

    // Ensure new bucket start aligns to hour
    const newBucket = afterRotation!.buckets[afterRotation!.currentBucketIndex];
    const newStart = new Date(newBucket.startTime);
    expect(newStart.getUTCMinutes()).toBe(0);
    expect(newStart.getUTCSeconds()).toBe(0);
  });

  it('computes and verifies integrity hash; recovers from corruption via backup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-hash-'));
    const clock = new MockClock(Date.UTC(2025, 0, 1, 0, 0, 0));
    const svc = new UsageBucketsService(dir, {}, { timeProvider: () => clock.nowDate() });
    await svc.initialize();
    await svc.recordUsage({ operation: 'list', success: true });

    const file = path.join(dir, 'usage-buckets.json');
    const bak = file + '.bak';
    const original = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(original);
    expect(parsed.containerHash).toBeTruthy();

    // Simulate corruption of primary
    fs.writeFileSync(file, original.replace(/"totalEntries":\s*\d+/, '"totalEntries": 999999')); // tamper

    // Load new service - should detect hash mismatch and fall back to backup
    const svc2 = new UsageBucketsService(dir, {}, { timeProvider: () => clock.nowDate() });
    await svc2.initialize();
    const container2 = svc2._debugGetContainer();
    expect(container2).toBeTruthy();
    expect(container2!.totalEntries).not.toBe(999999); // recovered state

    // Corrupt both primary & backup -> rebuild new container
    fs.writeFileSync(file, '{"bad": true}');
    if (fs.existsSync(bak)) fs.writeFileSync(bak, '{"alsoBad": true}');
    const svc3 = new UsageBucketsService(dir, {}, { timeProvider: () => clock.nowDate() });
    await svc3.initialize();
    const container3 = svc3._debugGetContainer();
    expect(container3).toBeTruthy();
    expect(container3!.buckets.length).toBeGreaterThan(0);
  });
});
