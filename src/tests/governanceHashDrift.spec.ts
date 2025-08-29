import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { waitFor, parseToolPayload } from './testUtils';

function startServer(){ return spawn('node',[path.join(__dirname,'../../dist/server/index.js')],{ stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION:'1' } }); }
function send(p:ReturnType<typeof startServer>, msg:Record<string,unknown>){ p.stdin?.write(JSON.stringify(msg)+'\n'); }
function findLine(lines:string[], id:number){ return lines.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

// This test differentiates between two classes of change:
// (A) Whitespace-only modifications (hash should remain stable – already covered elsewhere, but reaffirmed here)
// (B) Semantic reordering of a link block (body textual change -> new hash)

describe('governance hash drift scenarios', () => {
  it('hash stable for whitespace-only, changes for link reordering', async () => {
    const server = startServer();
    const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,140));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'gov-hash-drift', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!findLine(out,1));

    const id = 'hash-drift-' + Date.now();
    const baseLinks = [
      '- https://github.com/microsoft/service-fabric',
      '- https://github.com/Azure/bicep',
      '- https://github.com/microsoft/semantic-kernel'
    ];
    const body = ['# Drift Test','Links:','',...baseLinks,'','EOF'].join('\n');
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Drift', body, priority:35, audience:'all', requirement:'optional', categories:['governance'], owner:'hash-owner' }, overwrite:true, lax:true } } });
    await waitFor(()=> !!findLine(out,2));
    send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } } });
    await waitFor(()=> !!findLine(out,3));
  const first = parseToolPayload<{ item:{ sourceHash:string } }>(findLine(out,3)!);
  const hash1 = first && first.item && first.item.sourceHash || '';
  expect(hash1).toBeTruthy();
  expect(hash1.length).toBe(64);

  // Whitespace-only tweak: add global leading/trailing blank lines (hash stable because trimmed)
  const bodyWhitespace = '\n' + body + '\n';
  // Local sanity: trimming should yield original body, therefore hash should match
  const localWhitespaceHash = crypto.createHash('sha256').update(bodyWhitespace.trim(),'utf8').digest('hex');
  if(localWhitespaceHash !== hash1){
    // eslint-disable-next-line no-console
    console.log('[gov-hash-drift][diag] Unexpected localWhitespaceHash mismatch', { hash1, localWhitespaceHash });
  }
    send(server,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Drift', body: bodyWhitespace, priority:35, audience:'all', requirement:'optional', categories:['governance'], owner:'hash-owner' }, overwrite:true, lax:true } } });
    await waitFor(()=> !!findLine(out,4));
    send(server,{ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } } });
    await waitFor(()=> !!findLine(out,5));
    const afterWhitespace = parseToolPayload<{ item:{ sourceHash:string } }>(findLine(out,5)!);
  expect(afterWhitespace?.item.sourceHash).toBe(hash1);

  // Reorder links (semantic change) -> expect new hash. If this unexpectedly remains stable,
  // we compute a local hash of the reordered body to help diagnose whether trimming or some
  // normalization path is neutralizing the change.
  const reordered = ['# Drift Test','Links:','',...[baseLinks[2], baseLinks[0], baseLinks[1]],'','EOF'].join('\n');
  const localReorderedHash = crypto.createHash('sha256').update(reordered.trim(),'utf8').digest('hex');
  // Sanity: local reordered hash should differ from original hash1 (body order changed)
  if(localReorderedHash === hash1){
    // Emit a diagnostic line (parsed by humans, ignored by JSON parsing in findLine helper)
    // This would imply an extremely unlikely SHA-256 collision or that hash1 was not the
    // original body hash we think it was.
    // We do not fail *here*; we still rely on the server-sourced assertion below.
    // eslint-disable-next-line no-console
    console.log('[gov-hash-drift][diag] Local reordered hash unexpectedly equals original hash:', localReorderedHash);
  }
  send(server,{ jsonrpc:'2.0', id:6, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'Drift', body: reordered, priority:35, audience:'all', requirement:'optional', categories:['governance'], owner:'hash-owner' }, overwrite:true, lax:true } } });
    await waitFor(()=> !!findLine(out,6));
    send(server,{ jsonrpc:'2.0', id:7, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } } });
    await waitFor(()=> !!findLine(out,7));
    const afterReorder = parseToolPayload<{ item:{ sourceHash:string } }>(findLine(out,7)!);
  expect(afterReorder?.item.sourceHash).not.toBe(hash1);
  // Additional assertion: server hash should match our local reordered hash (after normalization trimming)
  if(afterReorder?.item.sourceHash !== localReorderedHash){
    // Provide diagnostic to aid future investigation (non-fatal; primary assertion above governs test outcome)
    // eslint-disable-next-line no-console
    console.log('[gov-hash-drift][diag] Server hash differs from local hash', { server: afterReorder?.item.sourceHash, localReorderedHash });
  }

    server.kill();
  }, 25000);
});
