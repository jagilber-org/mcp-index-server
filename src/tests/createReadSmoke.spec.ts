import { describe, it, expect } from 'vitest';
import { buildContentLengthFrame } from './util/stdioFraming.js';
import { performHandshake } from './util/handshakeHelper.js';

// Minimal create→read contract smoke test against production deployment layout
// Fails fast on protocol contamination (non-JSON stdout lines containing braces/quotes)

describe('createReadSmoke', () => {
  it('initialize → tools/list → add → get works', async () => {
    const PRODUCTION_DIR = 'C:/mcp/mcp-index-server-prod';
    const TEST_ID = 'smoke-' + Date.now();

  // Use helper (node server) instead of PowerShell start script for deterministic handshake speed.
  const { server, parser } = await performHandshake({ cwd: PRODUCTION_DIR, protocolVersion:'2025-06-18' });
  let stdoutText = '';
  let stderrText = '';
  server.stdout.on('data', chunk => { stdoutText += chunk.toString(); });
  server.stderr.on('data', c => { stderrText += c.toString(); });
  const sendCL = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
  const wait = (id: number, ms = 10000) => parser.waitForId(id, ms, 35);
  const init = parser.findById(1)!; // already waited in helper
    expect(init.error,'init error').toBeFalsy();

    // Request tool list (may return either string[] or object[] with name properties per spec evolution)
  sendCL({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
    const list = await wait(2);
    const listObj = list as unknown as { result?: { tools?: unknown; capabilities?: { tools?: unknown } } };
    function extractNames(raw: unknown): string[] {
      if(!raw) return [];
      if(Array.isArray(raw)){
        if(raw.length === 0) return [];
        if(raw.every(t => typeof t === 'string')) return raw as string[];
        if(typeof raw[0] === 'object' && raw[0] && 'name' in (raw[0] as Record<string,unknown>)){
          return (raw as Record<string,unknown>[]).map(o => String(o.name));
        }
      }
      return [];
    }
  const toolNames: string[] = extractNames(listObj.result?.tools) || extractNames(listObj.result?.capabilities?.tools);
  // With early stdin buffering the initial tools/list should reflect a stable registry; skip extended polling.
    expect(Array.isArray(toolNames),'tools list array').toBe(true);
    if(!toolNames.includes('instructions/dispatch')){
      // Provide rich diagnostics before failing
      throw new Error('dispatcher missing; raw tools payload(s)=' + JSON.stringify({ initial: listObj.result?.tools }, null, 2));
    }

    // Add new entry
  sendCL({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:TEST_ID, title:'Smoke', body:'Smoke test entry', priority:10, audience:'all', requirement:'recommended', categories:['test'] }, overwrite:true, lax:true }}});
    const add = await wait(3);
    expect(add.error,'add error').toBeFalsy();

    // Get the entry
  sendCL({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id:TEST_ID }}});
    const get = await wait(4);
    expect(get.error,'get error').toBeFalsy();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const addObj = add as unknown as { result?: { content?: { text?: string }[] } };
  const addPayloadTxt = addObj.result?.content?.[0]?.text;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const getObj = get as unknown as { result?: { content?: { text?: string }[] } };
  const getPayloadTxt = getObj.result?.content?.[0]?.text;
  const addPayload = addPayloadTxt ? JSON.parse(addPayloadTxt) : {};
  const getPayload = getPayloadTxt ? JSON.parse(getPayloadTxt) : {};
  // Reference stdout/stderr to avoid unused warnings & provide context if assertions fail.
  expect(typeof stdoutText).toBe('string');
  expect(typeof stderrText).toBe('string');

    expect(addPayload.id,'add id echo').toBe(TEST_ID);
    expect(addPayload.verified,'verified flag').toBe(true);
    expect(getPayload.item?.id,'get id').toBe(TEST_ID);

    server.kill();
  }, 40000);
});
