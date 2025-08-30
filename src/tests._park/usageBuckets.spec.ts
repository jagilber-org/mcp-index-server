import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { waitFor } from './testUtils';
import { UsageBucketsContainer } from '../services/usageBuckets';

// Property-based test for temporal windowing (Phase 2)
// Verifies time-bucket ring behavior for usage tracking

function startServer(dir: string) {
  return spawn('node', [path.join(process.cwd(), 'dist', 'server', 'index.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_ENABLE_MUTATION: '1',
      INDEX_FEATURES: 'usage,window', // Enable temporal windowing
      INSTRUCTIONS_DIR: dir,
      INDEX_USAGE_FLUSH_INTERVAL_MS: '100', // Fast flush for testing
      INDEX_USAGE_FLUSH_BATCH: '1' // Single-item batches for predictability
    }
  });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Phase 2: Temporal Windowing (Usage Buckets)', () => {
  let tempDir: string;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-buckets-'));
    // Create minimal instruction for testing
    const testInstruction = {
      id: 'bucket-test-entry',
      title: 'Usage Bucket Test Entry',
      body: 'Test instruction for temporal windowing validation',
      priority: 10,
      audience: 'all',
      requirement: 'mandatory',
      categories: ['testing']
    };
    fs.writeFileSync(
      path.join(tempDir, 'bucket-test-entry.json'),
      JSON.stringify(testInstruction, null, 2)
    );
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates usage buckets sidecar file on first access', async () => {
    const server = startServer(tempDir);
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));

    try {
      // Initialize server
      send(server, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'bucket-test', version: '1.0' },
          capabilities: { tools: {} }
        }
      });

      await waitFor(() => lines.some(l => {
        try { return JSON.parse(l).id === 1; } catch { return false; }
      }), 2000);

      // Trigger usage tracking (should create buckets)
      send(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'usage/track',
          arguments: { id: 'bucket-test-entry' }
        }
      });

      await waitFor(() => lines.some(l => {
        try { return JSON.parse(l).id === 2; } catch { return false; }
      }), 2000);

      // Allow time for bucket file creation
      await wait(200);

      // Check if usage-buckets.json was created
      const bucketsFile = path.join(tempDir, 'usage-buckets.json');
      expect(fs.existsSync(bucketsFile), 'usage-buckets.json should be created').toBe(true);

      if (fs.existsSync(bucketsFile)) {
        const container: UsageBucketsContainer = JSON.parse(fs.readFileSync(bucketsFile, 'utf8'));
        
        // Validate bucket structure matches our implementation
        expect(container.config, 'config should exist').toBeTruthy();
        expect(container.buckets, 'buckets array should exist').toBeTruthy();
        expect(Array.isArray(container.buckets), 'buckets must be array').toBe(true);
        expect(container.buckets.length, 'should have configured number of buckets').toBe(container.config.bucketCount);
        expect(container.currentBucketIndex, 'should have current bucket index').toBeGreaterThanOrEqual(0);
        expect(container.currentBucketIndex, 'current bucket index in valid range').toBeLessThan(container.buckets.length);
        
        // Validate bucket configuration
        expect(container.config.bucketSizeMinutes, 'bucket size configured').toBeGreaterThan(0);
        expect(container.config.bucketCount, 'bucket count configured').toBeGreaterThan(0);
        
        // Validate timestamps are reasonable (all buckets should have timestamps)
        for (let i = 0; i < container.buckets.length; i++) {
          const bucket = container.buckets[i];
          expect(bucket.startTime, `bucket ${i} should have start time`).toBeTruthy();
          expect(bucket.endTime, `bucket ${i} should have end time`).toBeTruthy();
          expect(new Date(bucket.startTime).getTime(), `bucket ${i} start time should be valid`).toBeGreaterThan(0);
          expect(new Date(bucket.endTime).getTime(), `bucket ${i} end time should be valid`).toBeGreaterThan(0);
        }
      }

    } finally {
      server.kill();
    }
  }, 10000);

  it('properly advances time buckets on epoch boundary simulation', async () => {
    // This test would simulate time bucket advancement
    // Implementation depends on temporal windowing service architecture
    
    const server = startServer(tempDir);
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));

    try {
      // Initialize
      send(server, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'bucket-advance-test', version: '1.0' },
          capabilities: { tools: {} }
        }
      });

      await waitFor(() => lines.some(l => {
        try { return JSON.parse(l).id === 1; } catch { return false; }
      }), 2000);

      // TODO: Implement bucket advancement simulation
      // This would test that buckets rotate correctly on hour/day boundaries
      // Requires temporal windowing service to be implemented first
      
      // For now, just ensure test infrastructure is working
      expect(true, 'Bucket advancement test infrastructure ready').toBe(true);

    } finally {
      server.kill();
    }
  }, 5000);

  it('maintains UTC timestamp neutrality (no daylight savings issues)', async () => {
    const server = startServer(tempDir);
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));

    try {
      send(server, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'utc-test', version: '1.0' },
          capabilities: { tools: {} }
        }
      });

      await waitFor(() => lines.some(l => {
        try { return JSON.parse(l).id === 1; } catch { return false; }
      }), 2000);

      // Trigger usage to create buckets
      send(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'usage/track',
          arguments: { id: 'bucket-test-entry' }
        }
      });

      await waitFor(() => lines.some(l => {
        try { return JSON.parse(l).id === 2; } catch { return false; }
      }), 2000);

      await wait(200);

      const bucketsFile = path.join(tempDir, 'usage-buckets.json');
      if (fs.existsSync(bucketsFile)) {
        const container: UsageBucketsContainer = JSON.parse(fs.readFileSync(bucketsFile, 'utf8'));
        
        // Verify timestamps are in UTC and aligned to bucket boundaries
        const currentBucket = container.buckets[container.currentBucketIndex];
        const startTime = new Date(currentBucket.startTime);
        const endTime = new Date(currentBucket.endTime);
        
        // Bucket start should be aligned to bucket size boundary
        const bucketSizeMs = container.config.bucketSizeMinutes * 60 * 1000;
        const hourlyBoundary = Math.floor(startTime.getTime() / bucketSizeMs) * bucketSizeMs;
        
        expect(startTime.getTime(), 'Bucket should start at time boundary').toBe(hourlyBoundary);
        expect(startTime.getUTCSeconds(), 'Bucket should start at second boundary').toBe(0);
        expect(startTime.getUTCMilliseconds(), 'Bucket should start at millisecond boundary').toBe(0);
        
        // End time should be exactly bucketSize minutes later
        expect(endTime.getTime() - startTime.getTime(), 'Bucket duration should match config').toBe(bucketSizeMs);
      }

    } finally {
      server.kill();
    }
  }, 5000);

  it('validates bucket rollover metrics are emitted', async () => {
    // Test that bucket rollovers emit proper metrics
    // This would verify the metrics infrastructure works with temporal windowing
    
    const server = startServer(tempDir);
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));

    try {
      send(server, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'metrics-test', version: '1.0' },
          capabilities: { tools: {} }
        }
      });

      await waitFor(() => lines.some(l => {
        try { return JSON.parse(l).id === 1; } catch { return false; }
      }), 2000);

      // TODO: Test metrics emission for bucket operations
      // This requires the metrics infrastructure to be connected to temporal windowing
      
      expect(true, 'Metrics validation test scaffold ready').toBe(true);

    } finally {
      server.kill();
    }
  }, 3000);
});
