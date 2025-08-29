#!/usr/bin/env node
// Portable MCP smoke test client
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const wantJson = process.argv.includes('--json');

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: ['server.mjs'] });
  const client = new Client({ name: 'portable-smoke-client', version: '1.0.0' }, { capabilities: { tools: {} } });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map(t => t.name);

  const echo = await client.callTool({ name: 'echo', arguments: { message: 'hello portable' } });
  const math = await client.callTool({ name: 'math', arguments: { op: 'add', a: 2, b: 5 } });
  const sys = await client.callTool({ name: 'system_info', arguments: {} });

  const summary = {
    toolCount: names.length,
    tools: names,
    echo: echo.content?.[0]?.text || null,
    math: math.content?.[0]?.text || null,
    system: sys.content?.[0]?.text || null,
    ok: names.length === 3 && !!echo.content && !!math.content && !!sys.content
  };

  if (wantJson) {
    console.log(JSON.stringify(summary));
  } else {
    console.log('[portable-smoke] tools:', names);
    console.log('[portable-smoke] echo:', summary.echo);
    console.log('[portable-smoke] math:', summary.math);
    console.log('[portable-smoke] system:', summary.system);
    console.log('[portable-smoke] ok:', summary.ok);
  }

  await transport.close();
  if (!summary.ok) process.exit(2);
}

main().catch(e => { console.error('[portable-smoke-error]', e); process.exit(1); });
