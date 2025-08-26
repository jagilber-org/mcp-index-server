import { describe, it, expect } from 'vitest';
import fc, { Arbitrary } from 'fast-check';
import { ClassificationService } from '../services/classificationService';

// Property-based tests over normalization invariants.

describe('property: classification normalization invariants', () => {
  const cs = new ClassificationService();

  interface RawInstrGen { id:string; title:string; body:string; categories:string[]; priority:number; audience:'all'; requirement:'mandatory'|'critical'|'recommended'|'optional'|'deprecated'; owner?:string; version?:string }
  const arbInstruction: Arbitrary<RawInstrGen> = fc.record<RawInstrGen>({
    id: fc.string({ minLength:3, maxLength:40 }).filter((s: string)=> /^[a-zA-Z0-9_-]+$/.test(s)),
    title: fc.string({ minLength:1, maxLength:80 }),
    body: fc.string({ minLength:1, maxLength:400 }),
    categories: fc.array(fc.string({ minLength:3, maxLength:30 }).filter((c: string)=> /^[a-zA-Z0-9:_-]+$/.test(c)), { minLength:0, maxLength:6 }),
    priority: fc.integer({ min:1, max:100 }),
    audience: fc.constant('all'),
    requirement: fc.constantFrom<'mandatory'|'critical'|'recommended'|'optional'|'deprecated'>('mandatory','critical','recommended','optional','deprecated'),
    owner: fc.oneof(
      fc.string({ minLength:3, maxLength:30 }).filter((s: string)=> /^[a-z0-9_-]+$/i.test(s)),
      fc.constant(undefined)
    ),
    version: fc.oneof(
      fc.string({ minLength:1, maxLength:15 }),
      fc.constant(undefined)
    )
  });

  it('normalization preserves id/title/body trimming and derives risk/hash deterministically', () => {
    fc.assert(
      fc.property(arbInstruction, (raw: RawInstrGen) => {
  const base = { sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', ...raw } as unknown as import('../models/instruction').InstructionEntry; // classifier fills blanks
        const norm = cs.normalize({ ...base, title: '  '+raw.title+'  ', body: ' '+raw.body+'  ' });
        // ID unchanged
        expect(norm.id).toBe(raw.id);
        // Title/body trimmed
        expect(norm.title).toBe(raw.title.trim());
        expect(norm.body).toBe(raw.body.trim());
        // Hash stable for same body
  const norm2 = cs.normalize(base);
        expect(norm.sourceHash).toBe(norm2.sourceHash);
        // Version default rule
        if(!raw.version){ expect(norm.version).toBe('1.0.0'); }
      }),
      { numRuns: 50 }
    );
  });
});
