import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { callTool } from './testUtils';

const DIR = path.join(process.cwd(),'tmp','manifest-skip');
const SNAP = path.join(process.cwd(),'snapshots','catalog-manifest.json');

beforeAll(async () => {
  process.env.MCP_ENABLE_MUTATION = '1';
  process.env.MCP_MANIFEST_WRITE = '1';
  process.env.INSTRUCTIONS_DIR = DIR;
  fs.rmSync(DIR,{recursive:true,force:true});
  fs.mkdirSync(DIR,{recursive:true});
  // side-effect imports
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/handlers.instructions');
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/instructions.dispatcher');
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/handlers.manifest');
});

describe('manifest no-change skip', () => {
  it('second refresh does not rewrite identical manifest', async () => {
    const id = 'skip-test-' + Date.now();
    await callTool('instructions/add', { entry:{ id, body:'body', title:'Title', priority:1, audience:'all', requirement:'optional', categories:['skip'] }, overwrite:false });
    // First explicit refresh
    await callTool('manifest/refresh', {});
    expect(fs.existsSync(SNAP)).toBe(true);
    const stat1 = fs.statSync(SNAP);
    const content1 = fs.readFileSync(SNAP,'utf8');
    // Wait a tiny bit to ensure mtime difference would be observable if write occurred
    await new Promise(r=>setTimeout(r,25));
    // Second refresh should detect no change and skip write
    await callTool('manifest/refresh', {});
    const stat2 = fs.statSync(SNAP);
    const content2 = fs.readFileSync(SNAP,'utf8');
    expect(content2).toBe(content1);
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs); // skipped write preserves mtime
  });
});
