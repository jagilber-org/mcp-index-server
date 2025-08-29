#!/usr/bin/env node
// Portable MCP compliant test server (echo, math, system_info)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import os from 'os';

const server = new Server(
  { name: 'portable-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'echo', description: 'Echo back a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
    { name: 'math', description: 'Basic arithmetic', inputSchema: { type: 'object', properties: { op: { type: 'string', enum: ['add','sub','mul','div'] }, a: { type: 'number' }, b: { type: 'number' } }, required: ['op','a','b'] } },
    { name: 'system_info', description: 'System info summary', inputSchema: { type: 'object', properties: {}, required: [] } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === 'echo') {
      return { content: [{ type: 'text', text: JSON.stringify({ message: args.message ?? '', ts: new Date().toISOString() }) }] };
    }
    if (name === 'math') {
      const { op, a, b } = args; let result;
      switch (op) { case 'add': result = a + b; break; case 'sub': result = a - b; break; case 'mul': result = a * b; break; case 'div': if (b===0) throw new Error('division by zero'); result = a / b; break; default: throw new Error('bad op'); }
      return { content: [{ type: 'text', text: JSON.stringify({ op,a,b,result }) }] };
    }
    if (name === 'system_info') {
      return { content: [{ type: 'text', text: JSON.stringify({ platform: os.platform(), arch: os.arch(), cpus: os.cpus().length }) }] };
    }
    throw new Error('unknown tool');
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  console.error('[portable-server] starting');
  await server.connect(transport);
  console.error('[portable-server] ready');
  process.stdin.resume();
  await new Promise(()=>{});
}

main().catch(e => { console.error('[portable-server-error]', e); process.exit(1); });
