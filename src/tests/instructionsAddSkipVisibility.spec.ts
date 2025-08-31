import { describe, it, expect } from 'vitest';
import { buildContentLengthFrame } from './util/stdioFraming.js';
import { performHandshake } from './util/handshakeHelper.js';

// Validates reliability patch: duplicate add (skip) still guarantees immediate visibility via list/get
// and never returns notFound. If internal repair occurred, response may include repaired flags.

describe('instructions/add skip visibility reliability', () => {
  it('duplicate add (skip) preserves immediate visibility', async () => {
    const PRODUCTION_DIR = 'C:/mcp/mcp-index-server-prod';
    const id = 'skip-visibility-' + Date.now();
    const body = 'Test body for skip visibility reliability patch';

    const { server, parser } = await performHandshake({ cwd: PRODUCTION_DIR, protocolVersion:'2025-06-18' });
    const send = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
    const wait = (reqId: number, ms = 12000) => parser.waitForId(reqId, ms, 40);

    // First add (overwrite:true to ensure deterministic create)
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body, priority:50, audience:'all', requirement:'optional', categories:[] }, overwrite:true, lax:true }}});
    const add1 = await wait(2);
    expect(add1.error).toBeFalsy();

    // Duplicate add without overwrite should skip
    send({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body, priority:50, audience:'all', requirement:'optional', categories:[] }, overwrite:false, lax:true }}});
    const add2 = await wait(3);
    expect(add2.error).toBeFalsy();

    // List (request minimal diff list)
    send({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list', expectId:id }}});
    const list = await wait(4);
    const listTxt = (list as any).result?.content?.[0]?.text;
    const listObj = listTxt? JSON.parse(listTxt): {};
    const found = !!listObj.items?.find((e: any)=> e.id===id);
    expect(found).toBe(true);

    // Get entry
    send({ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id }}});
    const get = await wait(5);
    const getTxt = (get as any).result?.content?.[0]?.text;
    const getObj = getTxt? JSON.parse(getTxt): {};
    expect(getObj.notFound).not.toBe(true);

    server.kill();
  }, 35000);
});
