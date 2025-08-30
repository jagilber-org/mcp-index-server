import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, parseToolPayload, ensureFileExists } from './testUtils';

// Regression (RED) test: instructions/import should NOT count entries that fail governance validation
// Current implementation increments `imported` before governance prerequisite checks, so an entry
// missing mandatory owner (e.g. requirement=critical without owner) is still counted as imported even
// though it is rejected (no file written + error recorded). This test codifies the expected invariant:
// imported === number of actually persisted (valid) entries. It is expected to FAIL until handler fixed.

function startServer(instructionsDir: string){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio:['pipe','pipe','pipe'],
    env:{ ...process.env, MCP_ENABLE_MUTATION:'1', INSTRUCTIONS_DIR: instructionsDir }
  });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

describe('instructions/import consistency (imported count matches persisted successes)', () => {
  it('reports imported count excluding governance-failed entries (expected RED current)', async () => {
    const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'import-inconsistency-'));
    const server = startServer(ISOLATED_DIR);
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    server.stderr.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));

    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'import-consistency', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findLine(out,1), 4000);

    // Three entries: (1) invalid critical w/out owner, (2) valid optional, (3) valid mandatory with owner
    const baseTs = Date.now();
  const invalidId = `consistency-invalid-${baseTs}`; // lowercase to satisfy schema
  const validIdA = `consistency-valida-${baseTs}`;   // all lowercase (schema: ^[a-z0-9][a-z0-9-_]*$)
  const validIdB = `consistency-validb-${baseTs}`;   // all lowercase
    const entries = [
      { id: invalidId, title: invalidId, body:'Invalid body', priority:15, audience:'all', requirement:'critical', categories:['Test','Import'] }, // missing owner -> should fail governance
      { id: validIdA, title: validIdA, body:'Valid body A', priority:55, audience:'all', requirement:'optional', categories:['Test','Import'], owner:'owner-a' },
      { id: validIdB, title: validIdB, body:'Valid body B', priority:45, audience:'all', requirement:'mandatory', categories:['Test','Import'], owner:'owner-b' }
    ];

    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/import', arguments:{ entries, mode:'overwrite' } } });
    await waitFor(()=> !!findLine(out,2), 4000);
    const importPayload = parseToolPayload<{ imported:number; skipped:number; overwritten:number; total:number; errors:{ id:string; error:string }[] }>(findLine(out,2)!);
    expect(importPayload, 'missing import payload').toBeTruthy();
    if(!importPayload) throw new Error('no import payload');

    // Governance error for invalidId should be recorded
    const errIds = new Set(importPayload.errors.map(e=> e.id));
    expect(errIds.has(invalidId), 'expected governance error for invalid critical entry').toBe(true);

    // Verify on-disk presence: invalid entry should NOT have a file; valid ones must.
    const invalidFile = path.join(ISOLATED_DIR, invalidId + '.json');
    expect(fs.existsSync(invalidFile), 'invalid entry file should not exist').toBe(false);
    const validFileA = path.join(ISOLATED_DIR, validIdA + '.json');
    const validFileB = path.join(ISOLATED_DIR, validIdB + '.json');
    await ensureFileExists(validFileA, 4000);
    await ensureFileExists(validFileB, 4000);

    // Immediately list to capture catalog view post-import
    send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> !!findLine(out,3), 4000);
    const listPayload = parseToolPayload<{ count:number; items:{ id:string }[] }>(findLine(out,3)!);
    expect(listPayload, 'missing list payload').toBeTruthy();
    if(!listPayload) throw new Error('no list payload');

    const listIds = new Set(listPayload.items.map(i=> i.id));
    expect(listIds.has(validIdA), 'list missing validIdA').toBe(true);
    expect(listIds.has(validIdB), 'list missing validIdB').toBe(true);
    expect(listIds.has(invalidId), 'invalid id should not appear in list').toBe(false);

    // Expected invariant (should pass after fix): imported === number of successfully persisted (non-error) entries.
    const expectedImported = entries.length - errIds.size; // 3 - 1 = 2
    // CURRENT BUG: handler counts invalid entry toward imported -> imported=3 causing this assertion to fail (RED)
    expect(importPayload.imported, `imported count mismatch (expected excluding errors). payload=${JSON.stringify(importPayload)}`).toBe(expectedImported);

    server.kill();
  }, 15000);
});
