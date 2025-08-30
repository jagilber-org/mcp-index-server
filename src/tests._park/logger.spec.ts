import { describe, it, expect, vi } from 'vitest';

describe('logger module modes', () => {
  it('emits human readable log by default', async () => {
    vi.resetModules();
    const errSpy: string[] = [];
    const orig = console.error;
  // override for capture
  console.error = ((msg?: unknown) => { if(typeof msg === 'string') errSpy.push(msg); }) as unknown as typeof console.error;
    const { log } = await import('../services/logger');
    log('info','test_evt',{ msg:'hello' });
    console.error = orig;
    expect(errSpy.some(l=> l.includes('TEST_EVT') || l.includes('test_evt'))).toBe(true);
  });
  it('emits JSON when MCP_LOG_JSON=1', async () => {
    vi.resetModules();
    process.env.MCP_LOG_JSON = '1';
    const errSpy: string[] = [];
    const orig = console.error;
  console.error = ((msg?: unknown) => { if(typeof msg === 'string') errSpy.push(msg); }) as unknown as typeof console.error;
    const { log } = await import('../services/logger');
    log('error','json_evt',{ msg:'boom' });
    console.error = orig;
    const parsed = errSpy.map(l=>{ try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]?.evt).toBe('json_evt');
    delete process.env.MCP_LOG_JSON;
  });
});
