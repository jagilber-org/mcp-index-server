import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ensureDir, ensureFileExists, ensureJsonReadable, waitForCatalogEntry } from './testUtils';

// This spec previously reused the shared instructions directory which can be mutated concurrently
// by other specs (spawning servers, adding/removing files). That introduced a rare race where the
// freshly written file was skipped or overwritten, yielding an undefined entry. We isolate to a
// unique temp directory per run and use deterministic helpers to eliminate the flake.
describe('minimal author submission normalization', () => {
  it('derives governance fields from only required author fields', async () => {
    const dir = path.join(process.cwd(),'tmp','minimal-author-' + Date.now().toString());
    await ensureDir(dir);
    const id = 'minimal_author_' + Date.now();
    const file = path.join(dir, id + '.json');
  fs.writeFileSync(file, JSON.stringify({
      id,
      title: 'Minimal Title',
      body: 'First line summary.\nMore body lines.',
      priority: 55,
      audience: 'all',
      requirement: 'optional',
      categories: ['testing','Normalization']
    }, null, 2));
  await ensureFileExists(file, 3000);
  // Additionally ensure the file is fully readable JSON to avoid partial write visibility causing a skip
  await ensureJsonReadable(file, 3000);
  let entry: unknown | undefined; let errors: string[] = []; let attempts = 0;
  try {
    const res = await waitForCatalogEntry(dir, id, 4000, 50);
    entry = res.entry; errors = res.errors; attempts = res.attempts;
  } catch(e){
    // Augment diagnostics with directory listing & file snippet if present to help root-cause rare flakes
    const listing = fs.existsSync(dir)? fs.readdirSync(dir).join(',') : 'missing-dir';
    const snippet = fs.existsSync(file)? fs.readFileSync(file,'utf8').slice(0,300) : 'missing-file';
    throw new Error(`minimalAuthor wait failure id=${id} attempts=${attempts} errors=${errors.join('|')} listing=${listing} snippet=${snippet} originalErr=${(e as Error).message}`);
  }
  expect(errors, errors.join('; ')).toEqual([]);
  expect(entry, 'expected catalog entry to be loaded').toBeTruthy();
  const typed = entry as { version:string; owner:string; priorityTier:string; semanticSummary?:string; lastReviewedAt?:string; nextReviewDue?:string; changeLog?:unknown[] };
    // Derived governance
  expect(typed.version).toBe('1.0.0');
  expect(typed.owner).toBe('unowned');
  expect(typed.priorityTier).toBe('P3'); // priority 55 -> P3
  expect(typed.semanticSummary && typed.semanticSummary.length>0).toBe(true);
  expect(typed.lastReviewedAt).toBeTruthy();
  expect(typed.nextReviewDue).toBeTruthy();
  expect(typed.changeLog && typed.changeLog.length>=1).toBe(true);
  });
});
