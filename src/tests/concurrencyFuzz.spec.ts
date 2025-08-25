// Ensure mutation-enabled handlers before importing registrations (redundant after dynamic evaluation but kept explicit)
process.env.MCP_ENABLE_MUTATION = '1';
import { describe, it, expect } from 'vitest';
import { getHandler } from '../server/registry';
import '../services/toolHandlers';

// Lightweight helper with unknown typing then narrowing inside tests
function call<T = unknown>(name:string, params:unknown): Promise<T>{
  const h = getHandler(name);
  if(!h) throw new Error('handler missing '+name);
  return Promise.resolve(h(params) as T);
}

describe('concurrency & fuzz', () => {
  it('parallel add/remove round trips remain consistent', async () => {
    const add = getHandler('instructions/add');
    expect(add).toBeTruthy();
    const ids = Array.from({ length: 8 }, (_,i)=> `zz_temp_${Date.now()}_${i}`);
    await Promise.all(ids.map(id => call('instructions/add', { entry: { id, body: 'temp body', priority:50, audience:'all', requirement:'optional', title: id }, overwrite:true, lax:true })));
    // Diff snapshot hash vs list
    const list = await call<{ items: { id:string }[] }>('instructions/list', {});
    for(const id of ids){
      expect(list.items.find(x=>x.id===id)).toBeTruthy();
    }
    await Promise.all(ids.map(id => call('instructions/remove', { ids:[id] })));
    const listAfter = await call<{ items: { id:string }[] }>('instructions/list', {});
    for(const id of ids){
      expect(listAfter.items.find(x=>x.id===id)).toBeFalsy();
    }
  });

  it('fuzz import with duplicates does not corrupt catalog', async () => {
    const baseId = `fuzz_${Date.now()}`;
    const entries = Array.from({ length: 5 }, (_,i)=> ({ id: baseId, title: 'dup', body: 'same', priority: 10+i, audience:'all', requirement:'optional' }));
  const res = await call<{ errors: unknown[] }>('instructions/import', { entries, mode:'overwrite' });
  expect(Array.isArray(res.errors)).toBe(true);
  const get = await call<{ item: { id:string } }>('instructions/get', { id: baseId });
  expect(get.item.id).toBe(baseId);
  });
});
