import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { waitForServerReady, waitForResponse, xorResultError, parseToolPayload } from './testUtils';

function start(env: Record<string,string|undefined> = {}){
  return spawn('node',[path.join(process.cwd(),'dist','server','index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, ...env } });
}
function collect(p: ReturnType<typeof start>, sink: string[]){ let buf=''; p.stdout.on('data',d=>{ buf+=d.toString(); const parts=buf.split(/\n/); buf=parts.pop()!; for(const raw of parts){ const line=raw.trim(); if(line) sink.push(line); } }); }
function send(p: ReturnType<typeof start>, msg: unknown){ p.stdin.write(JSON.stringify(msg)+'\n'); }

// Helper to parse outer envelope then inner tool payload (content[0].text) generically
function extractPayload<T=unknown>(line: string|undefined): T|undefined { return line? parseToolPayload<T>(line): undefined; }

type GovernanceHashPayload = { governanceHash: string; items?: unknown[] };

describe('MCP transcript end-to-end (initialize -> meta/tools -> governanceHash -> dispatch list)', () => {
  it('covers baseline (mutation disabled) and validates ordering + XOR invariants', async () => {
    const proc = start({ MCP_ENABLE_MUTATION: undefined });
    const lines: string[] = []; collect(proc, lines);

    // Phase 1: initialize + meta/tools handshake
    const metaEnv = await waitForServerReady(proc, lines, { initId: 101, metaId: 102 });
    expect(metaEnv, 'meta/tools envelope not received').toBeTruthy();
    if(!metaEnv) throw new Error('missing meta/tools');
    expect(xorResultError(metaEnv), 'meta/tools envelope violates XOR invariant').toBe(true);

    // Parse meta/tools payload
    const metaToolsPayload = extractPayload<{ tools: { method:string; mutation?: boolean; disabled?: boolean }[] }>(JSON.stringify(metaEnv));
    expect(metaToolsPayload?.tools.length).toBeGreaterThan(0);
    // Ensure governanceHash + dispatch appear
    const methods = new Set(metaToolsPayload!.tools.map(t=> t.method));
    expect(methods.has('instructions/governanceHash')).toBe(true);
    expect(methods.has('instructions/dispatch')).toBe(true);

    // Assert at least one mutation tool is marked disabled in this env
    const disabledMutation = metaToolsPayload!.tools.filter(t=> t.mutation && t.disabled);
    expect(disabledMutation.length).toBeGreaterThan(0);

    // Phase 2: governanceHash
    send(proc,{ jsonrpc:'2.0', id: 103, method:'tools/call', params:{ name:'instructions/governanceHash', arguments:{} } });
    const govEnv = await waitForResponse(lines, 103, 5000);
    expect(govEnv, 'governanceHash response missing').toBeTruthy();
    if(!govEnv) throw new Error('missing governanceHash response');
    expect(xorResultError(govEnv), 'governanceHash envelope violates XOR invariant').toBe(true);
    const govPayload = extractPayload<GovernanceHashPayload>(JSON.stringify(govEnv));
    expect(govPayload?.governanceHash).toBeTruthy();

    // Phase 3: dispatcher list
    send(proc,{ jsonrpc:'2.0', id: 104, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    const listEnv = await waitForResponse(lines, 104, 5000);
    expect(listEnv, 'dispatch list response missing').toBeTruthy();
    if(!listEnv) throw new Error('missing dispatch list response');
    expect(xorResultError(listEnv), 'dispatch list envelope violates XOR invariant').toBe(true);

    proc.kill();
  }, 25000);

  it('baseline then mutation enabled session (sanity that disabled flags disappear)', async () => {
    const proc = start({ MCP_ENABLE_MUTATION: '1' });
    const lines: string[] = []; collect(proc, lines);

    const metaEnv = await waitForServerReady(proc, lines, { initId: 201, metaId: 202 });
    expect(metaEnv).toBeTruthy();
    if(!metaEnv) throw new Error('missing meta/tools');
    expect(xorResultError(metaEnv)).toBe(true);

    const metaToolsPayload = extractPayload<{ tools: { method:string; mutation?: boolean; disabled?: boolean }[] }>(JSON.stringify(metaEnv));
    expect(metaToolsPayload?.tools.length).toBeGreaterThan(0);

    // Mutation tools should not be disabled when flag set
    const disabledMutation = metaToolsPayload!.tools.filter(t=> t.mutation && t.disabled);
    expect(disabledMutation.length).toBe(0);

    proc.kill();
  }, 20000);
});
