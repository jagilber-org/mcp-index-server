// Portable MCP client helper library providing generic CRUD scenario support.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function connect({ command='node', args=[], name='portable-generic-client', version='1.0.0', envOverrides={} }={}) {
  const env = { ...process.env, ...envOverrides };
  const transport = new StdioClientTransport({ command, args, env });
  const client = new Client({ name, version }, { capabilities: { tools: {} } });
  await client.connect(transport);
  return { client, transport };
}

// Create synthetic instruction entries (id, title, body, version, hash placeholder)
export function buildEntries(count=3, prefix='demo') {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const id = `${prefix}-${now}-${i+1}`;
    const body = `Instruction body ${i+1} @ ${now}`;
    return { id, title: `Title ${i+1}`, body, version: 1, hash: null };
  });
}

function classifyError(e) {
  const m = e?.message || String(e);
  if (/atomic.*readback/i.test(m)) return 'atomic_readback_failed';
  if (/not.?found/i.test(m)) return 'not_found';
  if (/conflict|version/i.test(m)) return 'conflict';
  return 'generic';
}

// Run CRUD against an index/instruction server that exposes tools: instructions/add, instructions/get, instructions/list, instructions/remove
export async function runCrudScenario({ command='node', args=['dist/server/index.js'] }, entries, { verbose=false, json=false, forceMutation=true, skipRemove=false }={}) {
  const started = performance.now();
  const summary = { created:0, listed:0, validated:0, removed:0, failures:[], durationMs:0 };

  // Ensure mutations enabled for child process if requested.
  if(forceMutation && process.env.MCP_ENABLE_MUTATION !== '1') {
    process.env.MCP_ENABLE_MUTATION = '1';
  }

  const { client, transport } = await connect({ command, args, envOverrides:{ MCP_ENABLE_MUTATION: process.env.MCP_ENABLE_MUTATION || (forceMutation? '1':'0') } });
  try {
    // Discover available tools to decide legacy vs dispatcher path.
    let toolNames = [];
  try { const list = await client.listTools(); toolNames = (list.tools||[]).map(t=>t.name); if(verbose) console.error('[crud] discovered tools:', toolNames.join(', ')); } catch(e){ if(verbose) console.error('[crud] tools/list failed', e.message); }
    const hasDispatcher = toolNames.includes('instructions/dispatch');
    const hasLegacyAdd = toolNames.includes('instructions/add');
    const hasLegacyList = toolNames.includes('instructions/list');
    const hasLegacyGet = toolNames.includes('instructions/get');
    const hasLegacyRemove = toolNames.includes('instructions/remove');

    async function callJSON(name, args){
      const resp = await client.callTool({ name, arguments: args });
      const txt = resp.content?.[0]?.text;
      if(!txt) return undefined;
      try { return JSON.parse(txt); } catch { return undefined; }
    }

    async function addEntry(entry){
      try {
        if(hasDispatcher){
          const args = { action:'add', entry:{ id:entry.id, title:entry.title, body:entry.body, priority:50, audience:'all', requirement:'optional', categories:[], lax:true }, overwrite:true, lax:true };
          if(verbose) console.error('[crud] add via dispatcher', JSON.stringify(args));
          const obj = await callJSON('instructions/dispatch', args);
          entry.hash = obj?.hash || obj?.id || entry.id;
        } else if(hasLegacyAdd){
          const obj = await callJSON('instructions/add', { entry:{ id:entry.id, title:entry.title, body:entry.body }, overwrite:true, lax:true });
          entry.hash = obj?.hash || obj?.id || entry.id;
        } else {
          throw new Error('no_add_method_available');
        }
        summary.created++;
      } catch(e){ summary.failures.push({ phase:'add', id:entry.id, error: classifyError(e) }); if(verbose) console.error('[add-fail]', entry.id, e.message); }
    }

    async function listEntries(){
      try {
        if(hasDispatcher){
          const args = { action:'list' };
          if(verbose) console.error('[crud] list via dispatcher');
          const obj = await callJSON('instructions/dispatch', args);
          const items = Array.isArray(obj?.items)? obj.items: [];
          summary.listed = items.length; return items.map(i=>i.id).filter(Boolean);
        } else if(hasLegacyList){
          const obj = await callJSON('instructions/list', {});
          // Legacy list returned an array or object depending on era; be flexible.
          if(Array.isArray(obj)) { summary.listed = obj.length; return obj.map(i=> i.id||i); }
          const items = Array.isArray(obj?.items)? obj.items: [];
          summary.listed = items.length; return items.map(i=> i.id).filter(Boolean);
        } else { throw new Error('no_list_method_available'); }
      } catch(e){ summary.failures.push({ phase:'list', error: classifyError(e) }); return []; }
    }

    async function getEntry(id, expectedBody){
      try {
        let obj;
  if(hasDispatcher){ const args = { action:'get', id }; if(verbose) console.error('[crud] get via dispatcher', id); obj = await callJSON('instructions/dispatch', args); }
        else if(hasLegacyGet){ obj = await callJSON('instructions/get', { id }); }
        else throw new Error('no_get_method_available');
        const body = obj?.item?.body || obj?.body; // dispatcher get returns { item }, legacy may return full object.
        if(body === expectedBody) { summary.validated++; }
        else { summary.failures.push({ phase:'validate', id, mismatch:true }); }
      } catch(e){ summary.failures.push({ phase:'get', id, error: classifyError(e) }); }
    }

    async function removeEntry(id){
      try {
  if(hasDispatcher){ const args = { action:'remove', id }; if(verbose) console.error('[crud] remove via dispatcher', id); await callJSON('instructions/dispatch', args); }
        else if(hasLegacyRemove){ await callJSON('instructions/remove', { ids:[id], missingOk:true }); }
        else throw new Error('no_remove_method_available');
        summary.removed++;
      } catch(e){ summary.failures.push({ phase:'remove', id, error: classifyError(e) }); }
    }

    // Execute phases
    for(const entry of entries) { await addEntry(entry); }
    await listEntries();
    for(const entry of entries) { await getEntry(entry.id, entry.body); }
    if(!skipRemove){
      for(const entry of entries) { await removeEntry(entry.id); }
      // Final list probe (optional) - only if dispatcher to confirm removals
      if(hasDispatcher) await listEntries();
    } else if(hasDispatcher){
      // If skipping removal, refresh list to capture presence count
      await listEntries();
    }
  } finally {
    await transport.close();
    summary.durationMs = Math.round(performance.now() - started);
    summary.ok = summary.failures.length === 0;
    if (json) { console.log(JSON.stringify(summary)); }
    else {
      console.log('[crud] created:', summary.created, 'validated:', summary.validated, 'removed:', summary.removed, 'failures:', summary.failures.length, 'durationMs:', summary.durationMs);
      if (summary.failures.length) console.log('[crud] failures detail:', JSON.stringify(summary.failures, null, 2));
    }
  }
  return summary;
}

// Simple helper: fetch instruction count (dispatcher preferred) and return { count, hash, items? }
export async function countInstructions({ command='node', args=['dist/server/index.js'], list=false, verbose=false }={}){
  const { client, transport } = await connect({ command, args });
  try {
    let toolNames = [];
    try { const tl = await client.listTools(); toolNames = (tl.tools||[]).map(t=>t.name); } catch(e){ if(verbose) console.error('[count] tools/list failed', e.message); }
    const hasDispatcher = toolNames.includes('instructions/dispatch');
    const hasLegacyList = toolNames.includes('instructions/list');
    async function callJSON(name, args){ const resp = await client.callTool({ name, arguments: args }); const txt = resp.content?.[0]?.text; if(!txt) return undefined; try { return JSON.parse(txt); } catch { return undefined; } }
    if(hasDispatcher){
      const obj = await callJSON('instructions/dispatch', { action:'list' });
      const items = Array.isArray(obj?.items)? obj.items: [];
      return { count: obj?.count ?? items.length, hash: obj?.hash, items: list? items: undefined, via:'dispatcher' };
    } else if(hasLegacyList){
      const obj = await callJSON('instructions/list', {});
      if(Array.isArray(obj)) return { count: obj.length, items: list? obj: undefined, via:'legacy-array' };
      const items = Array.isArray(obj?.items)? obj.items: [];
      return { count: obj?.count ?? items.length, hash: obj?.hash, items: list? items: undefined, via:'legacy-object' };
    }
    return { error:'no_list_method_available' };
  } finally {
    await transport.close();
  }
}

// ---------------------------------------------------------------------------
// Discrete CRUD operation helpers (create/read/update/delete + list)
// Exposed for ad-hoc portable testing and programmatic composition.
// They share a single connection for a sequence; call close() when done.
// ---------------------------------------------------------------------------

function classifyListObject(obj){
  const items = Array.isArray(obj?.items) ? obj.items : [];
  return { items, count: obj?.count ?? items.length, hash: obj?.hash };
}

export async function createInstructionClient({ command='node', args=['dist/server/index.js'], forceMutation=true, verbose=false }={}) {
  if(forceMutation && process.env.MCP_ENABLE_MUTATION !== '1') process.env.MCP_ENABLE_MUTATION='1';
  const { client, transport } = await connect({ command, args, envOverrides:{ MCP_ENABLE_MUTATION: process.env.MCP_ENABLE_MUTATION || (forceMutation? '1':'0') } });
  // Discover dispatcher vs legacy
  let toolNames=[]; try { const tl = await client.listTools(); toolNames = (tl.tools||[]).map(t=>t.name); } catch(e){ if(verbose) console.error('[ops] tools/list failed', e.message); }
  const hasDispatcher = toolNames.includes('instructions/dispatch');
  const hasLegacyAdd = toolNames.includes('instructions/add');
  const hasLegacyList = toolNames.includes('instructions/list');
  const hasLegacyGet = toolNames.includes('instructions/get');
  const hasLegacyRemove = toolNames.includes('instructions/remove');

  async function callJSON(name, args){
    const resp = await client.callTool({ name, arguments: args });
    const txt = resp.content?.[0]?.text; if(!txt) return undefined;
    try { return JSON.parse(txt); } catch { return undefined; }
  }

  function normalizeEntryInput(entry){
    // Accept minimal {id, body} and fill with lax defaults
    const { id, title, body, priority=50, audience='all', requirement='optional', categories=[] } = entry;
    return { id, title: title||id, body, priority, audience, requirement, categories, lax:true };
  }

  async function create(entry,{ overwrite=true }={}){
    const norm = normalizeEntryInput(entry);
    if(hasDispatcher){
      return callJSON('instructions/dispatch', { action:'add', entry:norm, overwrite, lax:true });
    }
    if(hasLegacyAdd){
      return callJSON('instructions/add', { entry:norm, overwrite, lax:true });
    }
    throw new Error('no_add_method_available');
  }
  async function read(id){
    if(hasDispatcher){ return callJSON('instructions/dispatch', { action:'get', id }); }
    if(hasLegacyGet){ return callJSON('instructions/get',{ id }); }
    throw new Error('no_get_method_available');
  }
  async function update(entry){
    // For now update == create with overwrite in this API.
    return create(entry,{ overwrite:true });
  }
  async function remove(id){
    if(hasDispatcher){ return callJSON('instructions/dispatch', { action:'remove', id }); }
    if(hasLegacyRemove){ return callJSON('instructions/remove', { ids:[id], missingOk:true }); }
    throw new Error('no_remove_method_available');
  }
  async function list(){
    if(hasDispatcher){ const obj = await callJSON('instructions/dispatch', { action:'list' }); return classifyListObject(obj); }
    if(hasLegacyList){ const obj = await callJSON('instructions/list', {}); if(Array.isArray(obj)) return { items:obj, count:obj.length }; return classifyListObject(obj); }
    throw new Error('no_list_method_available');
  }
  async function close(){ await transport.close(); }
  return { create, read, update, remove, list, close, dispatcher: hasDispatcher };
}

// Orchestrated CRUD test using discrete helpers (create -> read -> update -> read -> delete).
export async function runCrudSequence({ command='node', args=['dist/server/index.js'], id, body='Body', updateBody='Updated Body', verbose=false, forceMutation=true, categories=[] }={}){
  const client = await createInstructionClient({ command, args, forceMutation, verbose });
  const result = { id, created:null, read1:null, updated:null, read2:null, removed:null, failures:[] };
  try {
    try { result.created = await client.create({ id, body, categories }); } catch(e){ result.failures.push({ phase:'create', error:e.message }); }
    try { result.read1 = await client.read(id); } catch(e){ result.failures.push({ phase:'read1', error:e.message }); }
    try { result.updated = await client.update({ id, body:updateBody, categories }); } catch(e){ result.failures.push({ phase:'update', error:e.message }); }
    try { result.read2 = await client.read(id); } catch(e){ result.failures.push({ phase:'read2', error:e.message }); }
    try { result.removed = await client.remove(id); } catch(e){ result.failures.push({ phase:'remove', error:e.message }); }
    result.ok = result.failures.length === 0;
  } finally { await client.close(); }
  return result;
}
