import { describe, it, expect } from 'vitest';
import { buildContentLengthFrame } from './util/stdioFraming.js';
import { performHandshake } from './util/handshakeHelper.js';

/*
  Visibility Invariant Tests
  Ensures: If instructions/dispatch add returns created:true, the entry MUST be immediately retrievable
  via action:get and discoverable via a query on its category or keyword without additional delay.
  This encodes the contractual guarantee we are hardening.
*/

describe('instructions/add visibility invariant', () => {
  it('created:true implies immediate get success + category discoverability', async () => {
    const PRODUCTION_DIR = 'C:/mcp/mcp-index-server-prod';
    const TEST_ID = 'vis-' + Date.now();
    const CATEGORY = 'invariant';

    const { server, parser } = await performHandshake({ cwd: PRODUCTION_DIR, protocolVersion:'2025-06-18' });
    const sendCL = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
    const wait = (id: number, ms = 10000) => parser.waitForId(id, ms, 35);
    const init = parser.findById(1)!; // waited in helper
    expect(init.error,'init error').toBeFalsy();

    // Add instruction
    sendCL({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:TEST_ID, title:'Visibility Invariant', body:'Body for visibility invariant test', priority:5, audience:'all', requirement:'optional', categories:[CATEGORY] }, overwrite:true, lax:true }}});
    const add = await wait(2);
    expect(add.error,'add error').toBeFalsy();
    const addPayloadTxt = (add as any)?.result?.content?.[0]?.text as string | undefined;
    const addPayload = addPayloadTxt ? JSON.parse(addPayloadTxt) : {};
    expect(addPayload.id,'add id echo').toBe(TEST_ID);
    expect(addPayload.created,'created flag').toBe(true);
    expect(addPayload.verified,'verified flag').toBe(true);

    // Immediate get MUST succeed
    sendCL({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id:TEST_ID }}});
    const get = await wait(3);
    expect(get.error,'get error').toBeFalsy();
    const getPayloadTxt = (get as any)?.result?.content?.[0]?.text as string | undefined;
    const getPayload = getPayloadTxt ? JSON.parse(getPayloadTxt) : {};
    expect(getPayload.item?.id,'get id mismatch').toBe(TEST_ID);

  // Immediate query discoverability (filter by category with generous limit to avoid pagination exclusion)
  sendCL({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'query', text:undefined, categoriesAll:[], categoriesAny:[CATEGORY], limit:1000 }}});
    const query = await wait(4);
    expect(query.error,'query error').toBeFalsy();
    const queryTxt = (query as any)?.result?.content?.[0]?.text as string | undefined;
    const queryPayload = queryTxt ? JSON.parse(queryTxt) : {};
    const foundIds = Array.isArray(queryPayload.items) ? queryPayload.items.map((it:any)=>it.id) : [];
    expect(foundIds,'query should include id').toContain(TEST_ID);

    server.kill();
  }, 45000);
});
