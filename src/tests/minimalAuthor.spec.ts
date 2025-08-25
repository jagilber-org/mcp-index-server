import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CatalogLoader } from '../services/catalogLoader';

describe('minimal author submission normalization', () => {
  const dir = path.join(process.cwd(),'instructions');
  it('derives governance fields from only required author fields', () => {
    if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
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
    const loader = new CatalogLoader(dir);
    const entry = loader.load().entries.find(e=> e.id===id)!;
    expect(entry).toBeTruthy();
    // Derived governance
    expect(entry.version).toBe('1.0.0');
    expect(entry.owner).toBe('unowned');
    expect(entry.priorityTier).toBe('P3'); // priority 55 -> P3
    expect(entry.semanticSummary && entry.semanticSummary.length>0).toBe(true);
    expect(entry.lastReviewedAt).toBeTruthy();
    expect(entry.nextReviewDue).toBeTruthy();
    expect(entry.changeLog && entry.changeLog.length>=1).toBe(true);
  });
});
