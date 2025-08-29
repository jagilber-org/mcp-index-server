import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeEntry, removeEntry, ensureLoaded, invalidate } from '../services/catalogContext';
import '../services/toolHandlers'; // registers core handlers (includes instructions handlers)
import { getHandler } from '../server/registry';
import type { InstructionEntry } from '../models/instruction';

// Provide a typed helper for handler invocation to avoid any casts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericHandler = (params: unknown) => Promise<unknown>; // handlers are wrapped async
function h(name: string): GenericHandler { const fn = getHandler(name); if(!fn) throw new Error('handler not found: '+name); return (p:unknown)=> Promise.resolve(fn(p as never)); }

// Helper to invoke and unwrap optional response envelope
async function call<T=unknown>(name:string, params:Record<string,unknown>): Promise<T>{
  const raw = await h(name)(params);
  if(raw && typeof raw==='object' && 'version' in (raw as Record<string,unknown>) && 'data' in (raw as Record<string,unknown>)) return (raw as { data:T }).data;
  return raw as T;
}

interface QueryResponse { count:number; items: Array<{ id:string }>; }
interface CategoriesResponse { count:number; categories: Array<{ name:string; count:number }>; }
interface AddResponse { error?: string }

describe('instructions/dispatch query & categories actions', () => {
  const baseEntries: Partial<InstructionEntry & { priorityTier?: 'P1'|'P2'|'P3'|'P4'; owner?: string }>[] = [
    { id:'q-alpha', title:'Alpha Security Guide', body:'Alpha body about auth', priority:10, audience:'all', requirement:'mandatory', categories:['security','auth'], owner:'team-sec', priorityTier:'P1' },
    { id:'q-beta', title:'Beta Performance', body:'Beta body latency', priority:40, audience:'all', requirement:'optional', categories:['performance'], owner:'team-perf', priorityTier:'P2' },
    { id:'q-gamma', title:'Gamma Misc', body:'General guidance misc', priority:70, audience:'all', requirement:'optional', categories:['general'], owner:'team-gen', priorityTier:'P3' }
  ];

  let prevMutationFlag: string | undefined;
  beforeAll(() => {
    // Enable mutation for add handler prerequisite enforcement checks
    prevMutationFlag = process.env.MCP_ENABLE_MUTATION;
    process.env.MCP_ENABLE_MUTATION = '1';
    const now = new Date().toISOString();
    for(const e of baseEntries) {
      writeEntry({
        id: e.id!,
        title: e.title!,
        body: e.body!,
        priority: e.priority!,
        audience: e.audience as InstructionEntry['audience'],
        requirement: e.requirement as InstructionEntry['requirement'],
        categories: (e.categories||[]).map(c=>c.toLowerCase()),
        sourceHash: 'seed',
        schemaVersion: '1',
        createdAt: now,
        updatedAt: now,
        owner: e.owner,
        priorityTier: e.priorityTier
      } as InstructionEntry);
    }
    invalidate(); ensureLoaded();
  });
  afterAll(() => {
    for(const e of baseEntries) removeEntry(e.id!);
  // Cleanup test-created entries
  removeEntry('q-ok');
  removeEntry('q-bad');
    invalidate();
    if(prevMutationFlag === undefined) delete process.env.MCP_ENABLE_MUTATION; else process.env.MCP_ENABLE_MUTATION = prevMutationFlag;
  });

  it('filters by categoriesAll and requirement (dispatcher action=query)', async () => {
    ensureLoaded();
    const res = await call<QueryResponse>('instructions/dispatch', { action:'query', categoriesAll:['security','auth'], requirements:['mandatory'] });
    // Avoid brittle exact cardinality; ensure at least 1 and target present
    // IMPORTANT: Do NOT assert exact res.count===1 here. Multiple seeded or future entries could legitimately match.
    if((res as unknown as { count?:number }).count === 1){
      // fine, but not required; keep as informational comment + guard in case future contributors try to reintroduce exact equality
    }
    expect(res.count).toBeGreaterThanOrEqual(1);
    expect(res.items.some(i=> i.id==='q-alpha')).toBe(true);
  });

  it('returns category taxonomy (dispatcher action=categories)', async () => {
  const res = await call<CategoriesResponse>('instructions/dispatch', { action:'categories' });
    const names = res.categories.map((c: {name:string})=>c.name).sort();
    expect(names).toContain('security');
    expect(names).toContain('performance');
    // categories handler returns { count, categories }; ensure at least seeded categories present
    expect(res.count).toBeGreaterThanOrEqual(3);
  });

  it('enforces P1 prerequisite (missing owner and/or category)', async () => {
    const result = await call<AddResponse>('instructions/add', { entry:{ id:'q-bad', title:'Bad', body:'b', priority:5, audience:'all', requirement:'optional', categories:['one'], priorityTier:'P1' }, overwrite:true });
    // If mutation unexpectedly disabled, surface clearer failure
    if(!result.error){
      throw new Error('Expected governance prerequisite error for P1 without owner & sufficient categories');
    }
    expect(result.error).toMatch(/P1 requires category & owner/);
  });

  it('allows non-P1 without owner', async () => {
  const result = await call<AddResponse>('instructions/add', { entry:{ id:'q-ok', title:'Ok', body:'b', priority:80, audience:'all', requirement:'optional', categories:['misc'], priorityTier:'P3' }, overwrite:true });
    expect(result.error).toBeUndefined();
  });
});
