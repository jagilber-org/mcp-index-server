#!/usr/bin/env node
// Ad-hoc discrete CRUD operations & full sequence executor.
// Examples:
//   node ops-crud-client.mjs --create --id demo1 --body "Hello"
//   node ops-crud-client.mjs --read --id demo1
//   node ops-crud-client.mjs --update --id demo1 --body "New body"
//   node ops-crud-client.mjs --delete --id demo1
//   node ops-crud-client.mjs --crud --id demo2 --body "B" --update-body "C"
//   node ops-crud-client.mjs --list --json
import { createInstructionClient, runCrudSequence } from './client-lib.mjs';

function parse(argv){
  const opts = { command:'node', args:['../dist/server/index.js'], json:false, verbose:false, id:null, body:null, updateBody:null, categories:[], actions:[] };
  for(let i=2;i<argv.length;i++){
    const a = argv[i];
    if(a==='--command' && argv[i+1]) opts.command = argv[++i];
    else if(a==='--args' && argv[i+1]) opts.args = argv[++i].split(',').filter(Boolean);
    else if(a==='--id' && argv[i+1]) opts.id = argv[++i];
    else if(a==='--body' && argv[i+1]) opts.body = argv[++i];
    else if(a==='--update-body' && argv[i+1]) opts.updateBody = argv[++i];
    else if(a==='--categories' && argv[i+1]) opts.categories = argv[++i].split(',').filter(Boolean);
    else if(a==='--create') opts.actions.push('create');
    else if(a==='--read') opts.actions.push('read');
    else if(a==='--update') opts.actions.push('update');
    else if(a==='--delete') opts.actions.push('delete');
    else if(a==='--list') opts.actions.push('list');
    else if(a==='--crud') opts.actions.push('crud');
    else if(a==='--json') opts.json = true;
    else if(a==='--verbose') opts.verbose = true;
    else if(a==='--help' || a==='-h') opts.help = true;
  }
  return opts;
}

function help(){
  console.log(`Usage: ops-crud-client [actions] [options]\n\nActions (choose one or many except --crud which is exclusive):\n  --create --read --update --delete --list --crud\n\nOptions:\n  --id <id>            Instruction id (required for create/read/update/delete/crud)\n  --body <text>        Body for create or initial body in crud (default 'Body')\n  --update-body <text> Updated body for update/crud (default 'Updated Body')\n  --categories a,b,c   Comma list categories\n  --command <cmd>      Server command (default node)\n  --args a,b,c         Server args (default ../dist/server/index.js)\n  --json               JSON output\n  --verbose            Diagnostics\n  --help               This help\n`);
}

async function main(){
  const opts = parse(process.argv);
  if(opts.help || !opts.actions.length){ help(); return; }
  if(opts.actions.includes('crud') && opts.actions.length>1){ console.error('Cannot combine --crud with other actions'); process.exit(1); }
  if(opts.actions.some(a=> a!=='list') && !opts.id){ console.error('Missing --id for selected action(s)'); process.exit(1); }
  if(opts.actions.includes('crud')){
    const r = await runCrudSequence({ command:opts.command, args:opts.args, id:opts.id, body:opts.body||'Body', updateBody:opts.updateBody||'Updated Body', categories:opts.categories, verbose:opts.verbose });
    if(opts.json) console.log(JSON.stringify(r)); else console.log('[crud-sequence]', r);
    process.exit(r.ok?0:2);
  }
  const ic = await createInstructionClient({ command:opts.command, args:opts.args, verbose:opts.verbose });
  const out = { results:[], failures:[] };
  try {
    for(const act of opts.actions){
      try {
        if(act==='create') out.results.push({ action:act, result: await ic.create({ id:opts.id, body:opts.body||'Body', categories:opts.categories }) });
        else if(act==='read') out.results.push({ action:act, result: await ic.read(opts.id) });
        else if(act==='update') out.results.push({ action:act, result: await ic.update({ id:opts.id, body:opts.updateBody||opts.body||'Updated Body', categories:opts.categories }) });
        else if(act==='delete') out.results.push({ action:act, result: await ic.remove(opts.id) });
        else if(act==='list') out.results.push({ action:act, result: await ic.list() });
      } catch(e){ out.failures.push({ action:act, error: e.message }); }
    }
  } finally { await ic.close(); }
  out.ok = out.failures.length===0;
  if(opts.json) console.log(JSON.stringify(out)); else console.log('[ops]', out);
  process.exit(out.ok?0:2);
}

main().catch(e=>{ console.error('[ops-crud-client-error]', e); process.exit(1); });