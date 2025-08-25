/**
 * MCP Protocol Compliance Tests
 * Tests for VS Code MCP client compatibility - tools/list and tools/call handlers
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

function startServer() {
  return spawn('node', ['dist/server/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: { ...process.env, MCP_ENABLE_MUTATION: '1' }
  });
}

function send(server: ReturnType<typeof startServer>, obj: object) {
  server.stdin.write(JSON.stringify(obj) + '\n');
}

describe('MCP Protocol Compliance', () => {
  it('responds to initialize with proper MCP handshake', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    
    await new Promise(r => setTimeout(r, 150));
    
    // Send initialize request
    send(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {}
      }
    });
    
    await new Promise(r => setTimeout(r, 200));
    
    // Should have server/ready notification and initialize response
    const readyLine = lines.find(l => l.includes('server/ready'));
    expect(readyLine, 'missing server/ready notification').toBeTruthy();
    
    const readyObj = JSON.parse(readyLine!);
    expect(readyObj.method).toBe('server/ready');
    expect(readyObj.params.version).toBeTruthy();
    
    const initLine = lines.find(l => l.includes('"id":1'));
    expect(initLine, 'missing initialize response').toBeTruthy();
    
    const initObj = JSON.parse(initLine!);
    expect(initObj.result.protocolVersion).toBe('2025-06-18');
    expect(initObj.result.serverInfo.name).toBe('mcp-index-server');
    expect(initObj.result.capabilities).toBeTruthy();
    
    server.kill();
  }, 6000);

  it('implements tools/list with proper schema format', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    
    await new Promise(r => setTimeout(r, 150));
    
    // Send tools/list request
    send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });
    
    await new Promise(r => setTimeout(r, 200));
    
    const responseLine = lines.find(l => l.includes('"id":2'));
    expect(responseLine, 'missing tools/list response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeFalsy();
    expect(response.result).toBeTruthy();
    expect(Array.isArray(response.result.tools)).toBe(true);
    
    const tools = response.result.tools;
    expect(tools.length).toBeGreaterThan(10); // Should have many tools
    
    // Check that each tool has proper MCP format
    interface McpTool { name: string; description: string; inputSchema: object; }
    const sampleTool = (tools as McpTool[]).find(t => t.name === 'instructions/list');
    expect(sampleTool, 'missing instructions/list tool').toBeTruthy();
    if (!sampleTool) return; // Type guard
    expect(sampleTool.description).toBeTruthy();
    expect(typeof sampleTool.description).toBe('string');
    expect(sampleTool.inputSchema).toBeTruthy();
    expect(typeof sampleTool.inputSchema).toBe('object');
    
    // Verify critical tools are present
    const toolNames = (tools as McpTool[]).map(t => t.name);
    expect(toolNames).toContain('instructions/list');
    expect(toolNames).toContain('instructions/get');
    expect(toolNames).toContain('instructions/search');
    expect(toolNames).toContain('health/check');
    
    server.kill();
  }, 6000);

  it('implements tools/call and executes tools correctly', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    
    await new Promise(r => setTimeout(r, 150));
    
    // Test tools/call with health/check
    send(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'health/check',
        arguments: {}
      }
    });
    
    await new Promise(r => setTimeout(r, 200));
    
    const responseLine = lines.find(l => l.includes('"id":3'));
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
  }, 6000);

  it('tools/call handles invalid tool names gracefully', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    
    await new Promise(r => setTimeout(r, 150));
    
    // Test tools/call with non-existent tool
    send(server, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'non-existent-tool',
        arguments: {}
      }
    });
    
    await new Promise(r => setTimeout(r, 200));
    
    const responseLine = lines.find(l => l.includes('"id":4'));
    expect(responseLine, 'missing tools/call error response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeTruthy();
    expect(response.error.message).toContain('Internal error');
    // The actual error details should be in the data field
    expect(response.error.data).toBeTruthy();
    expect(response.error.data.message).toContain('Unknown tool');
    
    server.kill();
  }, 6000);

  it('tools/call executes instructions/list with parameters', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    
    await new Promise(r => setTimeout(r, 150));
    
    // Test tools/call with instructions/list
    send(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'instructions/list',
        arguments: { category: 'test' }
      }
    });
    
    await new Promise(r => setTimeout(r, 200));
    
    const responseLine = lines.find(l => l.includes('"id":5'));
    expect(responseLine, 'missing tools/call instructions/list response').toBeTruthy();
    
    const response = JSON.parse(responseLine!);
    expect(response.error).toBeFalsy();
    expect(response.result.content[0].type).toBe('text');
    
    // Parse the instructions list result
    const listResult = JSON.parse(response.result.content[0].text);
    expect(listResult.hash).toBeTruthy();
    expect(typeof listResult.count).toBe('number');
    expect(Array.isArray(listResult.items)).toBe(true);
    
    server.kill();
  }, 6000);
});
