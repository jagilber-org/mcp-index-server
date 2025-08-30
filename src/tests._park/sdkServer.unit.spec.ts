import { describe, it, expect, beforeAll } from 'vitest';
import { createSdkServer } from '../server/sdkServer';
import { z } from 'zod';

// Minimal fake Server class compatible with createSdkServer expectations.
class FakeServer {
  public handlers: { schema: z.ZodTypeAny; fn: (req: unknown) => unknown }[] = [];
  public oninitialized?: () => void;
  constructor(_info: unknown, _caps: unknown) {}
  setRequestHandler(schema: z.ZodTypeAny, fn: (req: unknown) => unknown){
    this.handlers.push({ schema, fn });
  }
  sendNotification(_n: unknown){ /* no-op */ }
  sendToolListChanged(){ /* no-op */ }
}

// Helper to find a handler by method literal (schema contains literal matcher).
function findHandler(server: FakeServer, method: string){
  for(const h of server.handlers){
    try {
      const parsed = h.schema.safeParse({ jsonrpc:'2.0', method });
      if(parsed.success) return h.fn;
    } catch { /* ignore */ }
  }
  throw new Error(`handler not found: ${method}`);
}

describe('createSdkServer unit (no process spawn)', () => {
  let server: FakeServer;
  beforeAll(() => {
    delete process.env.MCP_ENABLE_MUTATION; // force mutation disabled
    server = createSdkServer(FakeServer as unknown as { new(info:unknown, caps:unknown): unknown }) as unknown as FakeServer;
    server.oninitialized?.();
  });

  it('exposes tools/list + tools/call + ping handlers only (no direct per-tool handlers)', () => {
    const expected = new Set(['tools/list','tools/call','ping','initialize']);
    // Introspect zod literal method value (test-only; suppress any lint for internal shape access)
    const methods = server.handlers.map(h=>{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { const lit = (h.schema as unknown as any)?._def?.shape()?.method?._def?.value; return lit; } catch { return undefined; }
    }).filter((v): v is string => !!v);
    // Ensure required handlers present
    for(const m of expected){ expect(methods).toContain(m); }
    // Ensure removed legacy handler not present
    expect(methods).not.toContain('instructions/add');
  });

  it('tools/list returns tool registry snapshot', async () => {
    const fn = findHandler(server, 'tools/list');
    const result = await fn({ params:{} }) as { tools?: unknown };
    const tools = Array.isArray(result.tools) ? result.tools : [];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('tools/call unknown tool yields structured error (-32601)', async () => {
    const fn = findHandler(server, 'tools/call');
    try { await fn({ params:{ name:'not_a_tool', arguments:{} } }); throw new Error('expected error'); }
    catch(e){ const err = e as { code?: number }; expect(err.code).toBe(-32601); }
  });

  it('ping handler returns uptime info', async () => {
    const fn = findHandler(server, 'ping');
    const result = await fn({ params:{} }) as { timestamp?: unknown; uptimeMs?: unknown };
    expect(typeof result.timestamp).toBe('string');
    expect(typeof result.uptimeMs).toBe('number');
  });
});
