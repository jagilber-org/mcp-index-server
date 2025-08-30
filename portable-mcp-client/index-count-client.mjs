#!/usr/bin/env node
// Instruction count probe using portable client helpers.
import { countInstructions } from './client-lib.mjs';

function parseArgs(argv){
  const out = { command:'node', args:['../dist/server/index.js'], json:false, list:false, verbose:false };
  for(let i=2;i<argv.length;i++){
    const a = argv[i];
    if(a==='--command' && argv[i+1]) out.command = argv[++i];
    else if(a==='--args' && argv[i+1]) out.args = argv[++i].split(',').filter(Boolean);
    else if(a==='--json') out.json = true;
    else if(a==='--list') out.list = true;
    else if(a==='--verbose') out.verbose = true;
    else if(a==='--help' || a==='-h') out.help = true;
  }
  return out;
}

async function main(){
  const opts = parseArgs(process.argv);
  if(opts.help){
    console.log('Usage: index-count-client [--json] [--list] [--command cmd] [--args a,b,c]\n' +
      'Defaults: command=node args=../dist/server/index.js');
    process.exit(0);
  }
  const result = await countInstructions({ command:opts.command, args:opts.args, list:opts.list, verbose:opts.verbose });
  if(opts.json) console.log(JSON.stringify(result));
  else if(result.error) console.log('[count] error:', result.error); else console.log(`[count] instructions=${result.count} via=${result.via} hash=${result.hash||'n/a'}`);
  if(result.error) process.exit(2);
}

main().catch(e=>{ console.error('[index-count-client-error]', e); process.exit(1); });