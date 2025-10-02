import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { callTool } from './testUtils';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

// Isolated instructions directory for this suite (avoid cross-test interference)
const MANIFEST_TEST_DIR = path.join(process.cwd(), 'tmp', 'manifest-lifecycle');

beforeAll(async () => {
  // Ensure mutation + manifest writing enabled for all tests in this file
  process.env.MCP_MUTATION = '1';
  process.env.MCP_MANIFEST_WRITE = '1';
  process.env.INSTRUCTIONS_DIR = MANIFEST_TEST_DIR; // must be set before handler imports
  reloadRuntimeConfig(); // Reload config after setting env vars
  fs.rmSync(MANIFEST_TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(MANIFEST_TEST_DIR, { recursive: true });
  // Dynamically import side-effect registration modules AFTER env is set
  // @ts-expect-error side-effect import
  await import('../services/handlers.instructions');
  // @ts-expect-error side-effect import
  await import('../services/instructions.dispatcher');
  // @ts-expect-error side-effect import
  await import('../services/handlers.manifest');
});

interface AddResponse { id:string; created:boolean; overwritten:boolean; hash:string }

describe('catalog manifest lifecycle', () => {
  it('writes manifest after add and reports zero drift', async () => {
    const id = 'manifest-test-' + Date.now();
    const add = await callTool<AddResponse>('instructions/add',{ entry:{ id, body:'hello world', title:'Hello', priority:10, audience:'all', requirement:'optional', categories:['manifest'] }, overwrite:false, lax:false });
    expect(add.created).toBe(true);
    // status should show present manifest and no drift
    const status = await callTool<{ manifestPresent:boolean; drift:number }>('manifest/status',{});
    expect(status.manifestPresent).toBe(true);
    expect(status.drift).toBe(0);
  });

  it('detects drift after manual file mutation and repair fixes it', async () => {
    
  const id = 'manifest-drift-' + Date.now();
    await callTool('instructions/add',{ entry:{ id, body:'orig body', title:'Orig', priority:5, audience:'all', requirement:'optional' }, overwrite:false, lax:false });
    const baseDir = process.env.INSTRUCTIONS_DIR || path.join(process.cwd(),'instructions');
    const file = path.join(baseDir, `${id}.json`);
    const raw = JSON.parse(fs.readFileSync(file,'utf8'));
    raw.body = 'mutated body';
    fs.writeFileSync(file, JSON.stringify(raw,null,2));
      // Force catalog reload so in-memory body diverges from manifest snapshot; drift detection compares
      // manifest entries to current catalog (not raw disk), so without reload drift would remain 0.
      await callTool('instructions/reload',{});
      // Manifest now stale until next mutation or explicit repair
    const drift1 = await callTool<{ drift:number }>('manifest/status',{});
    expect(drift1.drift).toBeGreaterThanOrEqual(1);
    const repair = await callTool<{ repaired:boolean; driftAfter:number }>('manifest/repair',{});
    expect(repair.repaired).toBe(true);
    expect(repair.driftAfter).toBe(0);
  });

  it('refresh rewrites manifest even when zero drift', async () => {
    
    const before = await callTool<{ manifestPresent:boolean }>('manifest/status',{});
    if(!before.manifestPresent){
      await callTool('manifest/refresh',{});
    }
    const refreshed = await callTool<{ refreshed:boolean }>('manifest/refresh',{});
    expect(refreshed.refreshed).toBe(true);
  });
});
