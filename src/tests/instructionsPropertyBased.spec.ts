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

  it('property: normalization is idempotent', () => {
    fc.assert(
      fc.property(arbInstruction, (raw: RawInstrGen) => {
        const base = { sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', ...raw } as unknown as import('../models/instruction').InstructionEntry;
        const norm1 = cs.normalize(base);
        const norm2 = cs.normalize(norm1);
        expect(norm2).toEqual(norm1);
      }),
      { numRuns: 40 }
    );
  });

  it('property: category & scope extraction lowers/dedups and extracts workspace/user/team IDs', () => {
    const catCore = fc.array(fc.string({ minLength:3, maxLength:12 }).filter(s=>/^[a-zA-Z0-9_-]+$/.test(s)), {minLength:0,maxLength:4});
    const wsSlug = fc.option(fc.string({ minLength:3, maxLength:10 }).filter(s=>/^[a-z0-9_-]+$/i.test(s)), { nil: undefined });
    const userSlug = fc.option(fc.string({ minLength:3, maxLength:10 }).filter(s=>/^[a-z0-9_-]+$/i.test(s)), { nil: undefined });
    const teamSlugs = fc.array(fc.string({ minLength:3, maxLength:8 }).filter(s=>/^[a-z0-9_-]+$/i.test(s)), {minLength:0,maxLength:3});
    fc.assert(
      fc.property(arbInstruction, catCore, wsSlug, userSlug, teamSlugs, (raw, baseCats, wOpt, uOpt, tArr) => {
        // Build mixed categories with random casing & duplicates & scope prefixes
        let cats: string[] = [...baseCats];
        if(wOpt) cats.push('scope:workspace:'+wOpt);
        if(uOpt) cats.push('scope:user:'+uOpt.toUpperCase()); // introduce case variance
        for(const t of tArr){ cats.push('scope:team:'+t); if(Math.random()<0.5) cats.push('scope:team:'+t.toUpperCase()); }
        // Add deliberate duplicates & mixed case for non-scope
        if(baseCats.length){ cats.push(baseCats[0].toUpperCase()); }
        const base = { sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', ...raw, categories: cats } as unknown as import('../models/instruction').InstructionEntry;
        const norm = cs.normalize(base);
        // All remaining categories should be lowercase, sorted & contain no scope:* entries
        for(const c of norm.categories){ expect(c).toBe(c.toLowerCase()); expect(c.startsWith('scope:')).toBe(false); }
        const sorted = [...norm.categories].slice().sort();
        expect(norm.categories).toEqual(sorted);
        // workspace/user/team extraction (only if not already set in entry — we did not set them)
        if(wOpt) expect(norm.workspaceId).toBe(wOpt.toLowerCase());
        if(uOpt) expect(norm.userId).toBe(uOpt.toLowerCase());
        if(tArr.length){
          const uniqLower = Array.from(new Set(tArr.map(t=>t.toLowerCase())));
          if(norm.teamIds){ expect(norm.teamIds.sort()).toEqual(uniqLower.sort()); }
        }
      }),
      { numRuns: 35 }
    );
  });

  it('property: hash stability under surrounding whitespace changes', () => {
    fc.assert(
      fc.property(arbInstruction, fc.string({minLength:0, maxLength:5}).map(ws=> ' '.repeat(ws.length)), (raw, pad) => {
        const base = { sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', ...raw } as unknown as import('../models/instruction').InstructionEntry;
        const variant = { ...base, body: pad + raw.body + pad };
        const norm1 = cs.normalize(base);
        const norm2 = cs.normalize(variant);
        expect(norm1.sourceHash).toBe(norm2.sourceHash);
      }),
      { numRuns: 40 }
    );
  });

  it('property: priority tier mapping matches specification', () => {
    fc.assert(
      fc.property(arbInstruction, (raw) => {
        const base = { sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', ...raw } as unknown as import('../models/instruction').InstructionEntry;
        const norm = cs.normalize(base);
        const expectedTier = (() => {
          if(raw.priority <= 20 || raw.requirement === 'mandatory' || raw.requirement === 'critical') return 'P1';
          if(raw.priority <= 40) return 'P2';
          if(raw.priority <= 70) return 'P3';
          return 'P4';
        })();
        expect(norm.priorityTier).toBe(expectedTier);
      }),
      { numRuns: 50 }
    );
  });

  it('property: risk score strictly decreases as numeric priority increases (same requirement)', () => {
    const pairArb = fc.record({
      requirement: fc.constantFrom<'mandatory'|'critical'|'recommended'|'optional'|'deprecated'>('mandatory','critical','recommended','optional','deprecated'),
      p1: fc.integer({min:1,max:90}),
      delta: fc.integer({min:1,max:9}) // ensure p2 > p1 but <=100
    });
    fc.assert(
      fc.property(pairArb, arbInstruction, (pair, rawTemplate) => {
        const { requirement, p1, delta } = pair; const p2 = Math.min(p1 + delta, 100);
        const common = { ...rawTemplate, requirement, priority: p1 };
        const inst1 = { sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:'', ...common } as unknown as import('../models/instruction').InstructionEntry;
        const inst2 = { ...inst1, priority: p2 };
        const r1 = cs.normalize(inst1).riskScore!;
        const r2 = cs.normalize(inst2).riskScore!;
        expect(r1).toBeGreaterThan(r2); // strictly decreasing
      }),
      { numRuns: 45 }
    );
  });
});
