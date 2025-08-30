#!/usr/bin/env node
// Generic portable MCP client: enumerate tools & invoke tools (single, all, interactive, schema-driven prompts).
// Usage examples:
//  node generic-client.mjs --list
//  node generic-client.mjs --tool echo --tool-args '{"message":"hi"}'
//  node generic-client.mjs --command node --args server.mjs --all --json
//  node generic-client.mjs --interactive
// Exit codes: 0=success, 1=usage/arg error, 2=tool invocation failures
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function parse(argv) {
  const opts = { command:'node', args:['server.mjs'], json:false, list:false, tool:null, toolArgs:{}, all:false, verbose:false, interactive:false, format:'text', describe:null, repl:false };
  for (let i=2;i<argv.length;i++) {
    const a = argv[i];
    if (a === '--command' && argv[i+1]) opts.command = argv[++i];
    else if (a === '--args' && argv[i+1]) opts.args = argv[++i].split(',').filter(Boolean);
    else if (a === '--json') opts.json = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--tool' && argv[i+1]) opts.tool = argv[++i];
    else if (a === '--tool-args' && argv[i+1]) { try { opts.toolArgs = JSON.parse(argv[++i]); } catch { console.error('[generic-client] Failed to parse --tool-args JSON'); process.exit(1);} }
    else if (a === '--all') opts.all = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--interactive') opts.interactive = true;
    else if (a === '--format' && argv[i+1]) opts.format = argv[++i];
    else if (a === '--describe' && argv[i+1]) opts.describe = argv[++i];
    else if (a === '--repl') opts.repl = true;
    else if (a === '--help' || a === '-h') { opts.help = true; }
  }
  return opts;
}

function printHelp() {
  console.log(`Generic MCP Client\nOptions:\n  --list                List tools only\n  --tool <name>         Invoke a specific tool\n  --tool-args <json>    JSON args for tool\n  --all                 Invoke all tools (no args)\n  --interactive         Interactive select & prompt for arguments (single call)\n  --repl                Persistent session; enter multiple tool invocations\n  --describe <tool>     Show schema/description for a tool then exit\n  --command <cmd>       Server command (default node)\n  --args a,b,c          Comma list server args (default server.mjs)\n  --format text|table   Output format when not --json (default text)\n  --json                JSON output summary\n  --verbose             Diagnostics\n  --help                Show help\n\nREPL usage examples:\n  toolName {"arg":"value"}\n  :list | :describe <tool> | :schema <tool> | :help | :exit\n`);
}

async function prompt(question) {
  const { stdin, stdout } = process;
  stdout.write(question);
  return await new Promise(res => {
    stdin.resume();
    stdin.once('data', d => { res(d.toString().trim()); });
  });
}

function buildArgsFromSchema(schema) {
  const args = {};
  if (!schema || schema.type !== 'object' || !schema.properties) return args;
  for (const [k,v] of Object.entries(schema.properties)) {
    let sample;
    switch(v.type) {
      case 'string': sample = v.enum ? v.enum[0] : ''; break;
      case 'number': case 'integer': sample = 0; break;
      case 'boolean': sample = false; break;
      case 'array': sample = []; break;
      case 'object': sample = {}; break;
      default: sample = null;
    }
    args[k] = sample;
  }
  return args;
}

async function main() {
  const opts = parse(process.argv);
  if (opts.help) { printHelp(); return; }
  const started = Date.now();
  const transport = new StdioClientTransport({ command: opts.command, args: opts.args });
  const client = new Client({ name:'portable-generic-client', version:'1.0.0' }, { capabilities:{ tools:{} } });
  if (opts.verbose) console.error('[generic] connecting', opts.command, opts.args.join(' '));
  await client.connect(transport);
  const toolsResp = await client.listTools();
  const tools = toolsResp.tools || [];
  const names = tools.map(t=>t.name);
  if (opts.repl) {
    console.log('[generic] REPL session started. Type :help for commands.');
    console.log('Tools:', names.join(', '));
    let errorCount = 0;
    while (true) {
      const line = await prompt('mcp> ');
      if (!line) continue;
      if (line === ':exit' || line === ':quit') break;
      if (line === ':help') { console.log('Commands: :list, :describe <tool>, :schema <tool>, :exit'); continue; }
      if (line === ':list') { console.log('Tools:', names.join(', ')); continue; }
      if (line.startsWith(':describe ') || line.startsWith(':schema ')) {
        const tname = line.split(/\s+/)[1];
        const tool = tools.find(t=>t.name===tname);
        if (!tool) { console.log('Not found:', tname); continue; }
        console.log('Tool:', tool.name);
        if (tool.description) console.log('Description:', tool.description);
        if (tool.inputSchema) console.log('Schema:', JSON.stringify(tool.inputSchema, null, 2));
        continue;
      }
      // parse invocation: toolName JSON
      const spaceIdx = line.indexOf(' ');
      let toolName = line;
      let argObj = {};
      if (spaceIdx > -1) {
        toolName = line.slice(0, spaceIdx);
        const jsonPart = line.slice(spaceIdx+1).trim();
        if (jsonPart) {
          try { argObj = JSON.parse(jsonPart); } catch(e) { console.log('Arg JSON parse error:', e.message); continue; }
        }
      }
      if (!names.includes(toolName)) { console.log('Unknown tool:', toolName); continue; }
      try {
        const t0 = Date.now();
        const resp = await client.callTool({ name: toolName, arguments: argObj });
        const latency = Date.now()-t0;
        const txt = resp.content?.map(c=>c.text).filter(Boolean).join('\n') || '(no content)';
        console.log(`[${toolName}] ${latency}ms -> ${txt}`);
      } catch(e) {
        errorCount++;
        console.log(`[${toolName}] ERROR:`, e.message);
      }
    }
    await transport.close();
    if (errorCount) process.exit(2); else return;
  }
  const summary = { tools:names, count:names.length, invoked:[], errors:[], durationMs:0 };
  const startTime = Date.now();
  if (opts.list && !opts.tool && !opts.all) {
    summary.durationMs = Date.now()-started;
    if (opts.json) console.log(JSON.stringify(summary));
    else console.log('[generic] tools:', names.join(', '));
    await transport.close();
    return;
  }
  if (opts.describe) {
    const tool = tools.find(t=>t.name===opts.describe);
    if (!tool) { console.error('Tool not found:', opts.describe); await transport.close(); process.exit(1); }
    if (opts.json) console.log(JSON.stringify(tool, null, 2));
    else {
      console.log(`Tool: ${tool.name}`);
      if (tool.description) console.log('Description:', tool.description);
      if (tool.inputSchema) {
        const schema = tool.inputSchema;
        console.log('Input type:', schema.type);
        if (schema.properties) {
          for (const [k,v] of Object.entries(schema.properties)) {
            console.log(`  - ${k}: ${v.type || 'any'}${v.description ? ' :: '+v.description : ''}`);
          }
        }
      }
    }
    await transport.close();
    return;
  }
  let toInvoke = [];
  if (opts.tool) toInvoke.push(opts.tool);
  else if (opts.all) toInvoke.push(...names);
  else if (opts.interactive) {
    // Interactive selection
    console.log('\nAvailable tools:'); names.forEach((n,i)=>console.log(`  [${i+1}] ${n}`));
    const choice = await prompt('Select tool number (or empty to cancel): ');
    const idx = parseInt(choice,10)-1;
    if (!isNaN(idx) && idx>=0 && idx<names.length) toInvoke = [names[idx]]; else { console.log('No selection.'); }
  }
  for (const name of toInvoke) {
    try {
      let args = (name === opts.tool) ? opts.toolArgs : {};
      const toolMeta = tools.find(t=>t.name===name);
      if (opts.interactive && toolMeta) {
        // Build prompts from schema
        const baseArgs = buildArgsFromSchema(toolMeta.inputSchema);
        for (const key of Object.keys(baseArgs)) {
          const val = await prompt(`Arg ${key} (${typeof baseArgs[key]}): `);
          if (val !== '') {
            // basic coercion
            if (baseArgs[key] === 0 && !isNaN(Number(val))) baseArgs[key] = Number(val);
            else if (typeof baseArgs[key] === 'boolean') baseArgs[key] = ['true','1','yes','y'].includes(val.toLowerCase());
            else baseArgs[key] = val;
          }
        }
        args = { ...baseArgs, ...args };
      }
      const t0 = Date.now();
      const resp = await client.callTool({ name, arguments: args });
      const latencyMs = Date.now()-t0;
      const text = resp.content?.[0]?.text || null;
      summary.invoked.push({ name, text, latencyMs });
      if (!resp.content || resp.isError) summary.errors.push({ name, error: 'tool-error' });
      if (opts.verbose) console.error('[generic] invoked', name, '->', text);
    } catch (e) {
      summary.errors.push({ name, error: e.message });
      if (opts.verbose) console.error('[generic] invoke-fail', name, e);
    }
  }
  summary.durationMs = Date.now()-startTime;
  if (opts.json) console.log(JSON.stringify(summary));
  else if (opts.format === 'table' && summary.invoked.length) {
    console.log('\nTool Results (latency ms)');
    const rows = summary.invoked.map(r => ({ tool:r.name, latency:r.latencyMs, text:(r.text||'').slice(0,60) }));
    // simple table
    const header = ['tool','latency','text'];
    console.log(header.join('\t'));
    rows.forEach(row => console.log(`${row.tool}\t${row.latency}\t${row.text}`));
    console.log(`Errors: ${summary.errors.length}`);
  } else {
    console.log('[generic] tools:', names.join(', '));
    summary.invoked.forEach(r => console.log(`[generic] ${r.name} (${r.latencyMs}ms): ${r.text}`));
    console.log('[generic] errors:', summary.errors.length, 'totalLatencyMs:', summary.durationMs);
  }
  await transport.close();
  if (summary.errors.length) process.exit(2);
}

main().catch(e => { console.error('[generic-client-error]', e); process.exit(1); });
