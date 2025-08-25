import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CatalogLoader } from '../services/catalogLoader';
import { InstructionEntry } from '../models/instruction';

// This test ensures enriched governance fields (owner, priorityTier, version bump, semanticSummary)
// survive a write + reload cycle (simulating server restart).

const instructionsDir = path.join(process.cwd(), 'instructions');

describe('governance persistence', () => {
  it('persists governance + semanticSummary fields across reload', () => {
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir,{recursive:true});
    const id = 'persist_sample';
    const file = path.join(instructionsDir, id + '.json');
    // Write a base record missing governance fields (simulates pre-enrichment file)
    const base: InstructionEntry = {
      id,
      title: 'Sample Instruction For Persistence',
      body: 'First line summary.\nMore details follow here.',
      priority: 10,
      audience: 'all',
      requirement: 'mandatory',
      categories: ['testing'],
      sourceHash: 'placeholder',
      schemaVersion: '1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as InstructionEntry;
    fs.writeFileSync(file, JSON.stringify(base,null,2));
    // Load (normalization should enrich governance)
    const loader1 = new CatalogLoader(instructionsDir);
    const first = loader1.load().entries.find(e => e.id === id)!;
    expect(first.priorityTier).toBe('P1'); // priority=10 mandatory => P1
    expect(first.owner).toBe('unowned');
    expect(first.version).toBe('1.0.0');
    expect(first.semanticSummary).toBeDefined();
    // Simulate server writing enriched version back to disk
    fs.writeFileSync(file, JSON.stringify(first,null,2));
    // Reload again - fields should remain (not reset to defaults differently)
    const loader2 = new CatalogLoader(instructionsDir);
    const second = loader2.load().entries.find(e => e.id === id)!;
    expect(second.priorityTier).toBe(first.priorityTier);
    expect(second.semanticSummary).toBe(first.semanticSummary);
    expect(second.version).toBe(first.version);
  });
});