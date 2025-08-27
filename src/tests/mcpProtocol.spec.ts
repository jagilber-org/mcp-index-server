/**
 * MCP Protocol Compliance Tests
 * Tests for VS Code MCP client compatibility - tools/list and tools/call handlers
 */
import { describe, it, expect } from 'vitest';
import { waitFor } from './testUtils';
import { waitForDist } from './distReady';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-mcp-'));
function startServer() {
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: { ...process.env, MCP_ENABLE_MUTATION: '1', INSTRUCTIONS_DIR: ISOLATED_DIR }
  });
}

// Robust line collector to avoid splitting JSON across chunk boundaries (reduces flakiness)
function attachLineCollector(stream: NodeJS.ReadableStream, sink: string[]) {
  let buffer = '';
  stream.on('data', d => {
    buffer += d.toString();
    const parts = buffer.split(/\n/);
    buffer = parts.pop()!; // leftover (possibly incomplete JSON)
    for (const p of parts) {
      const line = p.trim();
      if (line) sink.push(line);
    }
  });
}

function send(server: ReturnType<typeof startServer>, obj: object) {
  server.stdin.write(JSON.stringify(obj) + '\n');
}

async function waitForId(lines: string[], id: number, timeout = 5000) {
  try {
    await waitFor(() => lines.some(l => l.includes(`"id":${id}`)), timeout);
  } catch {
    // Fallback: brief additional passive wait (handles rare buffered emission delays)
    await new Promise(r=> setTimeout(r, 150));
  }
  return lines.find(l => l.includes(`"id":${id}`));
}

describe('MCP Protocol Compliance', () => {
  it('responds to initialize with proper MCP handshake', async () => {
  await waitForDist();
  const server = startServer();
  const lines: string[] = [];
  attachLineCollector(server.stdout, lines);

    // Send initialize request immediately; server may emit server/ready before or after
    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: { tools: {} } } });

    await waitFor(() => lines.some(l => l.includes('server/ready')));
    const readyLine = lines.find(l => l.includes('server/ready'));
    expect(readyLine, 'missing server/ready notification').toBeTruthy();
    const readyObj = JSON.parse(readyLine!);
    expect(readyObj.method).toBe('server/ready');
    expect(readyObj.params.version).toBeTruthy();

    const initLine = await waitForId(lines, 1);
    expect(initLine, 'missing initialize response').toBeTruthy();
    const initObj = JSON.parse(initLine!);
    expect(initObj.result.protocolVersion).toBe('2025-06-18');
    expect(initObj.result.serverInfo.name).toBe('mcp-index-server');
    expect(initObj.result.capabilities).toBeTruthy();
    expect(initObj.result.instructions).toContain('tools/call');

    server.kill();
  }, 6000);

  it('implements tools/list with proper schema format', async () => {
  await waitForDist();
  const server = startServer();
  const lines: string[] = [];
  attachLineCollector(server.stdout, lines);

  send(server, { jsonrpc: '2.0', id: 1001, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: { tools: {} } } });
  await waitForId(lines, 1001);
    
    // Send tools/list request
  send(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const responseLine = await waitForId(lines, 2);
    expect(responseLine, 'missing tools/list response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeFalsy();
    expect(response.result).toBeTruthy();
    expect(Array.isArray(response.result.tools)).toBe(true);
    
    const tools = response.result.tools;
    expect(tools.length).toBeGreaterThan(10); // Should have many tools
    
    // Check that each tool has proper MCP format
    interface McpTool { name: string; description: string; inputSchema: object; }
  const sampleTool = (tools as McpTool[]).find(t => t.name === 'instructions/dispatch');
  expect(sampleTool, 'missing instructions/dispatch tool').toBeTruthy();
    if (!sampleTool) return; // Type guard
    expect(sampleTool.description).toBeTruthy();
    expect(typeof sampleTool.description).toBe('string');
    expect(sampleTool.inputSchema).toBeTruthy();
    expect(typeof sampleTool.inputSchema).toBe('object');
    
    // Verify critical tools are present
    const toolNames = (tools as McpTool[]).map(t => t.name);
  expect(toolNames).toContain('instructions/dispatch');
    expect(toolNames).toContain('health/check');
    
    server.kill();
  }, 10000);

  it('implements tools/call and executes tools correctly', async () => {
  await waitForDist();
  const server = startServer();
  const lines: string[] = [];
  attachLineCollector(server.stdout, lines);

  send(server, { jsonrpc: '2.0', id: 1002, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: { tools: {} } } });
  await waitForId(lines, 1002);
    
    // Test tools/call with health/check
  send(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'health/check', arguments: {} } });
  const responseLine = await waitForId(lines, 3);
    expect(responseLine, 'missing tools/call response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeFalsy();
    expect(response.result).toBeTruthy();
    expect(response.result.content).toBeTruthy();
    expect(Array.isArray(response.result.content)).toBe(true);
    expect(response.result.content[0].type).toBe('text');
    
    // Parse the health check result from the text content
    const healthResult = JSON.parse(response.result.content[0].text);
    expect(healthResult.status).toBe('ok');
    expect(healthResult.version).toBeTruthy();
    expect(healthResult.timestamp).toBeTruthy();
    
    server.kill();
  }, 10000);

  it('tools/call handles invalid tool names gracefully', async () => {
  await waitForDist();
  const server = startServer();
  const lines: string[] = [];
  attachLineCollector(server.stdout, lines);
  send(server, { jsonrpc: '2.0', id: 1003, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: { tools: {} } } });
  await waitForId(lines, 1003);
    
    // Test tools/call with non-existent tool
  send(server, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'non-existent-tool', arguments: {} } });
  const responseLine = await waitForId(lines, 4, 6000);
  expect(responseLine, 'missing tools/call error response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeTruthy();
  // Under SDK the generic JSON-RPC message may be generic; we assert data payload
  expect(response.error.message).toBeTruthy();
    // The actual error details should be in the data field
    expect(response.error.data).toBeTruthy();
    expect(response.error.data.message).toContain('Unknown tool');
    
    server.kill();
  }, 10000);

  it('responds to ping', async () => {
  await waitForDist();
  const server = startServer();
  const lines: string[] = [];
  attachLineCollector(server.stdout, lines);
  send(server, { jsonrpc: '2.0', id: 2001, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: { tools: {} } } });
  await waitForId(lines, 2001);
  send(server, { jsonrpc: '2.0', id: 2002, method: 'ping', params: {} });
  const pingLine = await waitForId(lines, 2002, 6000);
  expect(pingLine, 'missing ping response').toBeTruthy();
    const pingObj = JSON.parse(pingLine!);
    expect(pingObj.result.timestamp).toBeTruthy();
    expect(typeof pingObj.result.uptimeMs).toBe('number');
    server.kill();
  }, 10000);

  it('tools/call executes dispatcher list action with parameters', async () => {
  await waitForDist();
  const server = startServer();
  const lines: string[] = [];
  attachLineCollector(server.stdout, lines);
  send(server, { jsonrpc: '2.0', id: 1004, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: { tools: {} } } });
  await waitForId(lines, 1004);
  send(server, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'instructions/dispatch', arguments: { action:'list', category: 'test' } } });
  const responseLine = await waitForId(lines, 5, 6000);
  expect(responseLine, 'missing tools/call dispatcher list response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeFalsy();
    expect(response.result.content[0].type).toBe('text');
    
    // Parse the instructions list result
    const listResult = JSON.parse(response.result.content[0].text);
    expect(listResult.hash).toBeTruthy();
    expect(typeof listResult.count).toBe('number');
    expect(Array.isArray(listResult.items)).toBe(true);
    
    server.kill();
  }, 10000);
});
