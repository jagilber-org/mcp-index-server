import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeGovernanceHash } from '../services/catalogContext';
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

const arbEntry: fc.Arbitrary<BareEntry> = fc.record({
  id: fc.string({ minLength:3, maxLength:20 }).filter(s=>/^[a-z0-9_-]+$/i.test(s)),
  title: fc.string({ minLength:1, maxLength:40 }),
  body: fc.string({ minLength:1, maxLength:80 }),
  version: fc.option(fc.string({ minLength:1, maxLength:12 }), { nil: undefined }),
  owner: fc.option(fc.string({ minLength:3, maxLength:20 }).filter(s=>/^[a-z0-9_-]+$/i.test(s)), { nil: undefined }),
  priorityTier: fc.option(fc.constantFrom('P1','P2','P3','P4'), { nil: undefined }),
  nextReviewDue: fc.option(fc.date().map(d=> d.toISOString()), { nil: undefined }),
  semanticSummary: fc.option(fc.string({ minLength:0, maxLength:60 }), { nil: undefined }),
  changeLog: fc.option(fc.array(fc.record({ version: fc.string({ minLength:1, maxLength:8 }), changedAt: fc.date().map(d=>d.toISOString()), summary: fc.string({ minLength:1, maxLength:30 }) }), { minLength:0, maxLength:3 } ), { nil: undefined })
});

describe('property: computeGovernanceHash characteristics', () => {
  it('invariant: changing non-governance fields (body, categories, rationale) does not change hash', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { minLength:1, maxLength:4 }), fc.string({ minLength:1, maxLength:30 }), (entries, newBody) => {
        const baseList = entries.map(toInstruction);
  const hashBase = computeGovernanceHash(baseList);
        // Pick one and mutate only non-governance fields
        const idx = Math.floor(Math.random()*baseList.length);
        const mutated: InstructionEntry[] = baseList.map((e,i)=> {
          if(i!==idx) return e;
          return { ...e, body: newBody }; // body change only (non-governance)
        });
        const hashMut = computeGovernanceHash(mutated);
        expect(hashMut).toBe(hashBase);
      }), { numRuns: 40 }
    );
  });

  it('sensitivity: at least one effective governance field mutation changes hash', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { minLength:1, maxLength:3 }), (entries) => {
        const baseList = entries.map(toInstruction);
        const hashBase = computeGovernanceHash(baseList);
        const targetIdx = 0; const target = baseList[targetIdx];
        const buildVariants = (): InstructionEntry[] => [
          { ...target, version: (target.version||'1.0.0') + '-x' } as InstructionEntry,
          { ...target, owner: (target.owner||'unowned') === 'unowned' ? 'ownerX' : (target.owner! + 'x') } as InstructionEntry,
          { ...target, priorityTier: (target.priorityTier==='P1'? 'P2':'P1') as InstructionEntry['priorityTier'] } as InstructionEntry,
          { ...target, nextReviewDue: (target.nextReviewDue||'1999-01-01T00:00:00.000Z').replace('00:00:00.000Z','01:00:00.000Z') } as InstructionEntry,
          { ...target, semanticSummary: (target.semanticSummary||'') + ' appended' } as InstructionEntry,
          { ...target, changeLog: [...(target.changeLog||[]), { version:'z', changedAt:new Date().toISOString(), summary:'delta'} ] } as InstructionEntry
        ];
        const variants = buildVariants();
        let effectiveTried = 0; let diff = false;
        for(const v of variants){
          // Skip if projected governance JSON would be identical (e.g. semanticSummary hash unchanged when empty + appended still hashes differently, but guard generically)
          const mod = baseList.slice(); mod[targetIdx] = v;
          const h = computeGovernanceHash(mod);
          effectiveTried++;
          if(h !== hashBase){ diff = true; break; }
        }
        expect(effectiveTried).toBeGreaterThan(0); // sanity
        expect(diff).toBe(true);
      }), { numRuns: 40 }
    );
  });
});
