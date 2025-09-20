import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { performHandshake } from './util/handshakeHelper.js';
import { buildContentLengthFrame } from './util/stdioFraming.js';

/*
  Manifest Edge Case Tests
  1. Disabled write flag (MCP_MANIFEST_WRITE=0) should suppress manifest creation even after mutation.
  2. Corrupted on-disk manifest should be repaired (rewritten) after a mutation when write enabled.
*/

function readManifest(){
  const fp = path.join(process.cwd(), 'snapshots', 'catalog-manifest.json');
  if(!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return null; }
}

function writeCorruptedManifest(){
  const dir = path.join(process.cwd(), 'snapshots');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'catalog-manifest.json'), '{"version":1,"entries":[{"id":"broken','utf8');
}

describe('manifest edge cases', () => {
  const FAST_COVERAGE = process.env.FAST_COVERAGE === '1';
  const maybeIt = FAST_COVERAGE ? it.skip : it;
  // Allow consumers to tune per-id wait via env; default higher for large instruction sets
  const WAIT_DISABLED_MS = Number(process.env.MANIFEST_TEST_WAIT_DISABLED_MS || 18000);
  const WAIT_REPAIR_MS = Number(process.env.MANIFEST_TEST_WAIT_REPAIR_MS || 20000);
  const POST_KILL_FLUSH_MS = Number(process.env.MANIFEST_TEST_POST_KILL_MS || 250);
  const DIST_INDEX = path.join(process.cwd(),'dist','server','index.js');
  const DEPLOY_PRESENT = fs.existsSync(DIST_INDEX);
  if(!DEPLOY_PRESENT){
    // If build artifacts missing (e.g. running in a minimal environment) skip gracefully.
    // Returning here keeps the suite green while signaling intent.
    it.skip('skip manifest edge cases (dist build missing)', () => {});
    return;
  }

  maybeIt('respects MCP_MANIFEST_WRITE=0 (no file produced)', async () => {
    const start = readManifest(); // may exist from previous runs
    // spawn with write disabled
    const { server, parser } = await performHandshake({ extraEnv:{ MCP_ENABLE_MUTATION:'1', MCP_MANIFEST_WRITE:'0' }});
    const send = (m:unknown)=> server.stdin.write(buildContentLengthFrame(m));
    // perform a simple add mutation which would normally trigger manifest update
    const id = 'mw-disabled-' + Date.now();
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'mw disabled', body:'body', priority:1, audience:'all', requirement:'optional', categories:['test'] }, overwrite:true, lax:true }}});
  await parser.waitForId(2, WAIT_DISABLED_MS, 50);
  server.kill();
  // allow fs flush of any background async writes before reading
  await new Promise(r=>setTimeout(r,POST_KILL_FLUSH_MS));
    const after = readManifest();
    // If there was no manifest initially it should remain null; if one existed it should be untouched (same timestamp & count)
    if(!start){
      expect(after, 'manifest should still be absent when disabled').toBeNull();
    } else {
      expect(after?.generatedAt).toBe(start.generatedAt);
      expect(after?.count).toBe(start.count);
    }
  }, Math.max(35000, WAIT_DISABLED_MS + 10000));

  maybeIt('repairs corrupted manifest after mutation', async () => {
    writeCorruptedManifest();
    const beforeTxt = fs.readFileSync(path.join(process.cwd(),'snapshots','catalog-manifest.json'),'utf8');
    expect(beforeTxt.startsWith('{"version":1,"entries":[{"id":"broken')).toBe(true);
    const { server, parser } = await performHandshake({ extraEnv:{ MCP_ENABLE_MUTATION:'1', MCP_MANIFEST_WRITE:'1' }});
    const send = (m:unknown)=> server.stdin.write(buildContentLengthFrame(m));
    const id = 'mw-repair-' + Date.now();
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:'mw repair', body:'body', priority:2, audience:'all', requirement:'optional', categories:['repair'] }, overwrite:true, lax:true }}});
  await parser.waitForId(2, WAIT_REPAIR_MS, 50);
  server.kill();
  await new Promise(r=>setTimeout(r,POST_KILL_FLUSH_MS));
    const repaired = readManifest();
    expect(repaired, 'manifest should exist after repair').not.toBeNull();
    expect(repaired?.count).toBeGreaterThanOrEqual(1);
    expect(typeof repaired?.generatedAt).toBe('string');
    // ensure JSON structure no longer truncated
    const repairedTxt = fs.readFileSync(path.join(process.cwd(),'snapshots','catalog-manifest.json'),'utf8');
    expect(repairedTxt.endsWith('\n') || repairedTxt.trim().endsWith('}')).toBe(true);
  }, Math.max(40000, WAIT_REPAIR_MS + 12000));
});
