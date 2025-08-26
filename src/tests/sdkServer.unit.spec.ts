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
  // createSdkServer returns the provided ServerClass instance; cast via unknown to FakeServer
  server = createSdkServer(FakeServer as unknown as { new(info:unknown, caps:unknown): unknown }) as unknown as FakeServer;
    // Trigger oninitialized to exercise notification path
    server.oninitialized?.();
  });

  it('lists tools', async () => {
    const fn = findHandler(server, 'tools/list');
  const result = await fn({ params:{} }) as { tools?: unknown };
  const tools = Array.isArray(result.tools) ? result.tools : [];
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
  });

  it('returns validation error for instructions/add missing entry', async () => {
    const fn = findHandler(server, 'instructions/add');
    try {
      await fn({ params:{} });
      throw new Error('expected error');
    } catch(e){
      const err = e as { code?: number; message?: string };
      expect(err.code).toBe(-32602); // Invalid params
    }
  });

  it('returns mutation disabled error for instructions/add valid entry', async () => {
    const fn = findHandler(server, 'instructions/add');
    try {
      await fn({ params:{ entry:{ id:'t1', body:'body', title:'t1', priority:1, audience:'all', requirement:'optional', categories:[] } } });
      throw new Error('expected mutation disabled error');
    } catch(e){
      const err = e as { code?: number; message?: string };
      expect(err.code).toBe(-32603);
      expect(err.message?.toLowerCase()).toContain('mutation');
    }
  });

  it('returns unknown tool error via tools/call', async () => {
    const fn = findHandler(server, 'tools/call');
    try {
      await fn({ params:{ name:'not_a_tool', arguments:{} } });
      throw new Error('expected unknown tool error');
    } catch(e){
  const err = e as { code?: number; message?: string; data?: unknown };
      expect(err.code).toBe(-32603);
      expect(err.message).toMatch(/Unknown tool/i);
    }
  });

  it('ping handler returns uptime info', async () => {
    const fn = findHandler(server, 'ping');
  const result = await fn({ params:{} }) as { timestamp?: unknown; uptimeMs?: unknown };
  expect(typeof result.timestamp).toBe('string');
  expect(typeof result.uptimeMs).toBe('number');
  });
});
