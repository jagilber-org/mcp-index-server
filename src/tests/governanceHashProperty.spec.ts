import { describe, it, expect } from 'vitest';
import { computeGovernanceHash, projectGovernance } from '../services/catalogContext';
import type { InstructionEntry } from '../models/instruction';

interface BareEntry {
  id: string; title: string; body: string; version?: string; owner?: string; priorityTier?: string; nextReviewDue?: string; semanticSummary?: string; changeLog?: { version:string; changedAt:string; summary:string }[];
}

function toInstruction(e: BareEntry): InstructionEntry {
  return {
    id: e.id,
    title: e.title,
    body: e.body,
    rationale: undefined,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: [],
    sourceHash: '',
    schemaVersion: '1',
    deprecatedBy: undefined,
    createdAt: '',
    updatedAt: '',
    riskScore: undefined,
    version: e.version,
    owner: e.owner,
    priorityTier: e.priorityTier as InstructionEntry['priorityTier'],
    nextReviewDue: e.nextReviewDue,
    semanticSummary: e.semanticSummary,
    changeLog: e.changeLog as InstructionEntry['changeLog']
  } as InstructionEntry;
}

// (Removed property-based arbitrary for invariance; deterministic test ensures stability.)

describe('property: computeGovernanceHash characteristics', () => {
  it('invariant: changing non-governance fields (body only) does not change hash (deterministic)', () => {
    // Deterministic small catalog
    const entries: InstructionEntry[] = [
      toInstruction({ id: 'e1', title: 'T1', body: 'B1' }),
      toInstruction({ id: 'e2', title: 'T2', body: 'B2', owner: 'own2', priorityTier: 'P2', version: '1.0.0' }),
      toInstruction({ id: 'e3', title: 'T3', body: 'B3', priorityTier: 'P4' })
    ];
    const baseHash = computeGovernanceHash(entries);
    // Mutate each body one at a time and ensure hash stability
    entries.forEach((_, idx) => {
      const clone = entries.map(e => ({ ...e }));
      clone[idx].body = clone[idx].body + ' MUT';
      const projBefore = projectGovernance(entries[idx]);
      const projAfter = projectGovernance(clone[idx]);
      expect(JSON.stringify(projAfter)).toBe(JSON.stringify(projBefore)); // governance projection unchanged
      const newHash = computeGovernanceHash(clone);
      expect(newHash).toBe(baseHash);
    });
  });

  // Deterministic sensitivity test (no property-based randomness): start from a fixed rich entry and
  // mutate each governance-relevant field one at a time, asserting hash changes every time.
  it('sensitivity: modifying each governance projection field changes hash', () => {
    const base = toInstruction({
      id: 'base_entry',
      title: 'Title Base',
      body: 'Body',
      version: '1.0.0',
      owner: 'owner_base',
      priorityTier: 'P3',
      nextReviewDue: '2099-01-01T00:00:00.000Z',
      semanticSummary: 'initial summary',
      changeLog: [ { version: '1.0.0', changedAt: '2000-01-01T00:00:00.000Z', summary: 'init' } ]
    });
    const hashBase = computeGovernanceHash([base]);
    const mutateAndExpect = (mutator: (c: InstructionEntry)=>void, label: string) => {
      const clone: InstructionEntry = { ...base, changeLog: base.changeLog ? [...base.changeLog] : undefined };
      mutator(clone);
      const projBefore = JSON.stringify(projectGovernance(base));
      const projAfter = JSON.stringify(projectGovernance(clone));
      expect(projAfter, `projection unchanged for ${label}, test setup invalid`).not.toBe(projBefore);
      const newHash = computeGovernanceHash([clone]);
      expect(newHash, `hash unchanged after ${label} mutation`).not.toBe(hashBase);
    };
    mutateAndExpect(c => { c.title = c.title + ' X'; }, 'title');
    mutateAndExpect(c => { c.version = '2.0.0'; }, 'version');
    mutateAndExpect(c => { c.owner = 'owner_alt'; }, 'owner');
    mutateAndExpect(c => { c.priorityTier = 'P1'; }, 'priorityTier');
    mutateAndExpect(c => { c.nextReviewDue = '2098-12-31T00:00:00.000Z'; }, 'nextReviewDue');
    mutateAndExpect(c => { c.semanticSummary = c.semanticSummary + ' delta'; }, 'semanticSummary');
    mutateAndExpect(c => { c.changeLog = (c.changeLog||[]).concat({ version: '2.0.0', changedAt: '2001-01-01T00:00:00.000Z', summary: 'second' }); }, 'changeLog');
  });
});
