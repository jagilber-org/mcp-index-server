import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { waitForDist } from './distReady';
import { waitFor, parseToolPayload } from './testUtils';

// This test simulates server startup with multiple pre-existing instruction files
// to ensure catalogLoader indexes all .json files (no silent drops) and that
// debugCatalog reflects any discrepancy.

describe('catalog pre-existing files load', () => {
  const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-catalog-'));
  const fileCount = 4;
  const ids = Array.from({ length: fileCount }, (_, i) => `preload_${Date.now()}_${i}`);
  beforeAll(async () => {
    // Pre-create files BEFORE server start
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const rec = {
        id,
        title: id,
        body: `Body ${i}`,
        priority: 50 + i,
        audience: 'all',
        requirement: 'optional',
        categories: ['pre'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0'
      };
      fs.writeFileSync(path.join(ISOLATED_DIR, id + '.json'), JSON.stringify(rec, null, 2));
    }
  });

  function startServer() {
    return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, INSTRUCTIONS_DIR: ISOLATED_DIR, MCP_ENABLE_MUTATION: '0', MCP_CATALOG_FILE_TRACE: '1' }
    });
  }

  function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>) { proc.stdin?.write(JSON.stringify(msg) + '\n'); }
  function findLine(lines: string[], id: number) { return lines.find(l => { try { return JSON.parse(l).id === id; } catch { return false; } }); }

  it('loads all pre-existing files into catalog', async () => {
    await waitForDist();
    const server = startServer();
    const out: string[] = []; server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    // initialize
    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'preload', version: '0' }, capabilities: { tools: {} } } });
    await waitFor(() => !!findLine(out, 1));

    // Call list (dispatcher)
    send(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action: 'list' } } });
    await waitFor(() => !!findLine(out, 2));
    const listLine = findLine(out, 2);
    const listPayload = listLine ? parseToolPayload<{ count?: number; items?: { id: string }[] }>(listLine) : undefined;
    expect(listPayload?.count).toBeGreaterThanOrEqual(fileCount);
    if (listPayload?.items) {
      const got = new Set(listPayload.items.map(i => i.id));
      ids.forEach(id => expect(got.has(id)).toBe(true));
    }

    // Debug catalog consistency
    send(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'instructions/debugCatalog', arguments: {} } });
    await waitFor(() => !!findLine(out, 3));
    const debugLine = findLine(out, 3);
    const debugPayload = debugLine ? parseToolPayload<{ before?: { fileCountOnDisk?: number; missingIds?: string[] }; after?: { count?: number } }>(debugLine) : undefined;
    expect(debugPayload?.before?.fileCountOnDisk).toBeGreaterThanOrEqual(fileCount);
    expect(debugPayload?.after?.count).toBeGreaterThanOrEqual(fileCount);
    if (debugPayload?.before?.missingIds) {
      expect(debugPayload.before.missingIds.length).toBe(0);
    }

    server.kill();
  }, 15000);
});
