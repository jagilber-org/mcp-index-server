#!/usr/bin/env node
// Generic portable MCP index CRUD client using client-lib helpers.
import { buildEntries, runCrudScenario } from './client-lib.mjs';

function parseArgs(argv) {
  const out = { entries:3, json:false, verbose:false, command:'node', args:['dist/server/index.js'], noRemove:false };
  for (let i=2;i<argv.length;i++) {
    const a = argv[i];
    if (a === '--entries' && argv[i+1]) { out.entries = parseInt(argv[++i],10); }
    else if (a === '--json') out.json = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--no-remove') out.noRemove = true;
    else if (a === '--command' && argv[i+1]) { out.command = argv[++i]; }
    else if (a === '--args' && argv[i+1]) { out.args = argv[++i].split(',').filter(Boolean); }
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(`Usage: index-crud-client [--entries N] [--json] [--verbose] [--no-remove] [--command cmd] [--args a,b,c]\n`+
    `Defaults: command=node args=dist/server/index.js entries=3. Use --no-remove to skip deletion stage.`);
    process.exit(0);
  }
  const entries = buildEntries(opts.entries);
  const summary = await runCrudScenario({ command:opts.command, args:opts.args }, entries, { verbose:opts.verbose, json:opts.json, skipRemove:opts.noRemove });
  if (!summary.ok) process.exit(2);
}

main().catch(e => { console.error('[index-crud-client-error]', e); process.exit(1); });
