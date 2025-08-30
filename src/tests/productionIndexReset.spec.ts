/**
 * Production Index Reset Verification
 * Verifies that after resetting corrupted production index with fresh template files,
 * CREATE and READ operations now work correctly.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
// fs no longer needed after switching to start.ps1 launch

const PRODUCTION_DIR = 'C:/mcp/mcp-index-server-prod';
const START_SCRIPT = path.join(PRODUCTION_DIR, 'start.ps1');
const TIMEOUT_MS = 30000; // Allow extra time for first-run dependency install via start.ps1

// Test instruction that previously failed in production
const TEST_INSTRUCTION = {
  id: "reset-verification-test-2025-08-30",
  title: "Reset Verification Test",
  body: "This instruction tests that the production index reset was successful and CREATE/READ operations now work correctly.",
  priority: 50,
  audience: "all",
  requirement: "recommended",
  categories: ["testing", "verification"]
};

async function testProductionServer() {
  return new Promise((resolve) => {
    // Launch via start.ps1 which auto-installs production dependencies if missing.
    const server = spawn('pwsh', ['-NoProfile', '-Command', `./${path.basename(START_SCRIPT)} -EnableMutation -VerboseLogging`], {
      cwd: PRODUCTION_DIR,
      env: {
        ...process.env,
        INSTRUCTIONS_DIR: path.join(PRODUCTION_DIR, 'instructions'),
        MCP_HANDSHAKE_TRACE: '1',
        MCP_LOG_DIAG: '1',
        MCP_LOG_VERBOSE: '1'
      },
      stdio: 'pipe'
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
  interface JsonRpcEnvelope { id?: number; result?: unknown; error?: unknown }
  const lines: JsonRpcEnvelope[] = [];

    let sdkStarted = false;
    const pushStdout = (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if(!line) continue;
        try { lines.push(JSON.parse(line)); } catch { /* ignore non JSON */ }
      }
    };

    server.stdout.on('data', pushStdout);
    server.stderr.on('data', d => { 
      const t = d.toString();
      stderrBuffer += t; 
      if(!sdkStarted && t.includes('SDK server started')){ sdkStarted = true; }
    });
  server.on('error', e => { stderrBuffer += '\n[server-error] ' + (e as Error).message; });

    const send = (m: Record<string, unknown>) => server.stdin.write(JSON.stringify(m) + '\n');
  const waitForId = (id: number, timeout = 10000) => new Promise<void>((res, rej) => {
      const start = Date.now();
      const tick = () => {
        if(lines.find(l => l && l.id === id)) return res();
        if(Date.now() - start > timeout) return rej(new Error('timeout waiting for id=' + id));
        setTimeout(tick, 40);
      };
      tick();
    });

    (async () => {
      try {
        // Initialize first; don't pipeline to avoid race with tools/call pre-handshake.
  // Wait for SDK server ready marker before sending initialize to avoid races with transport setup
  const startWait = Date.now();
  while(!sdkStarted && Date.now() - startWait < 15000){ await new Promise(r=>setTimeout(r,50)); }
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'reset-test', version:'1.0.0'} } });
  await waitForId(1, 20000); // allow extra time for first dependency install

        // Add (dispatcher)
        send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry: TEST_INSTRUCTION, overwrite:true, lax:true }}});
        await waitForId(2);

        // Get
        send({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id: TEST_INSTRUCTION.id }}});
        await waitForId(3);

        // List
        send({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' }}});
        await waitForId(4);
      } catch (e) {
        stderrBuffer += '\n[testProductionServer] sequence error: ' + (e as Error).message;
      } finally {
        // Give a brief flush window
        setTimeout(() => {
          try { server.kill(); } catch { /* ignore */ }
          resolve({ responses: lines, stderr: stderrBuffer, raw: stdoutBuffer });
        }, 150);
      }
    })();
  });
}

describe('Production Index Reset Verification', () => {
  it('CREATE and READ operations work after index reset', async () => {
  const result = await testProductionServer() as { responses: Record<string, unknown>[], stderr: string, raw: string };
  interface AddPayload { id?: string; verified?: boolean; created?: boolean; overwritten?: boolean }

  interface MCPToolEnvelope { id?: number; error?: unknown; result?: { content?: { type: string; text?: string }[] } }
  const responses = result.responses as MCPToolEnvelope[];
    
    // Debug: log all raw responses for diagnostic visibility if CREATE missing
    if (!responses.find(r => r.id === 2)) {
      console.log('[productionIndexReset][debug] Raw parsed responses:\n' + responses.map(r => JSON.stringify(r)).join('\n'));
      console.log('[productionIndexReset][debug] STDERR:\n' + result.stderr);
      console.log('[productionIndexReset][debug] RAW STDOUT:\n' + result.raw);
    }
    // Find the CREATE response (id: 2)
  const createResponse = responses.find(r => r.id === 2);
    expect(createResponse, 'CREATE operation should succeed').toBeTruthy();
    if (createResponse) {
      expect(createResponse.error, 'CREATE should not have error').toBeFalsy();
      // MCP tool responses place the JSON payload inside result.content[0].text
  const payloadText = createResponse.result?.content?.[0]?.text;
      expect(payloadText, 'CREATE payload text should exist').toBeTruthy();
  let createPayload: AddPayload = {};
  try { if (payloadText) createPayload = JSON.parse(payloadText); } catch { /* ignore parse */ }
  // Dispatcher add returns { created|overwritten, skipped, hash, verified }
  expect(createPayload.verified, 'CREATE should return verified status').toBe(true);
  expect(createPayload.id, 'CREATE payload should echo id').toBe(TEST_INSTRUCTION.id);
  const createdOrOverwritten = createPayload.created === true || createPayload.overwritten === true;
  expect(createdOrOverwritten, 'CREATE should indicate created or overwritten').toBe(true);
    }

    // Find the READ response (id: 3)  
  const readResponse = responses.find(r => r.id === 3);
    expect(readResponse, 'READ operation should return response').toBeTruthy();
    if (readResponse) {
      expect(readResponse.error, 'READ should not have error').toBeFalsy();
  const readText = readResponse.result?.content?.[0]?.text;
      expect(readText, 'READ payload text should exist').toBeTruthy();
  let readPayload: { notFound?: boolean; item?: { id?: string; title?: string } } = {};
  try { if (readText) readPayload = JSON.parse(readText); } catch { /* ignore parse */ }
      // Dispatcher get action returns shape { hash, item } or { notFound }
      expect(readPayload.notFound, 'READ should NOT return notFound after reset').toBeFalsy();
      expect(readPayload.item?.id, 'READ should return correct instruction id').toBe(TEST_INSTRUCTION.id);
      expect(readPayload.item?.title, 'READ should return correct instruction title').toBe(TEST_INSTRUCTION.title);
    }

    // Find the LIST response (id: 4)
  const listResponse = responses.find(r => r.id === 4);
    expect(listResponse, 'LIST operation should return response').toBeTruthy();
    if (listResponse) {
      expect(listResponse.error, 'LIST should not have error').toBeFalsy();
  const listText = listResponse.result?.content?.[0]?.text;
      expect(listText, 'LIST payload text should exist').toBeTruthy();
  // Dispatcher list action returns { hash, count, items }
  let listPayload: { hash?: string; count?: number; items?: unknown[] } = {};
  try { if (listText) listPayload = JSON.parse(listText); } catch { /* ignore parse */ }
      const arr = Array.isArray(listPayload.items) ? listPayload.items : [];
      expect(Array.isArray(arr), 'LIST should return items array').toBe(true);
      expect(arr.length, 'LIST should contain at least the created entry').toBeGreaterThanOrEqual(1);
      console.log('[productionIndexReset] SUCCESS: CREATE/READ operations work after index reset');
      console.log(`[productionIndexReset] Catalog now contains ${arr.length} entries (hash=${listPayload.hash || 'n/a'})`);
    }
  }, TIMEOUT_MS);
});
