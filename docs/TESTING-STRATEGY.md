# Testing Strategy

This document describes the layered test approach to continuously expand coverage without exploding maintenance cost.

## Layers

1. Unit (pure logic)  
   - Classification normalization invariants (property-based).  
   - Governance hash projection & risk scoring.
2. Service (in-process)  
   - Handlers: add/import/get/list/remove/enrich/groom/governance-update.  
   - Error surfacing (loader errors, schema failures).
3. Protocol (black-box)  
   - JSON-RPC lifecycle: initialize -> tool calls -> graceful shutdown.  
   - Persistence across restart (round-trip) & disappearance regression.
4. Concurrency / Stress  
   - Rapid duplicate adds / overwrites (deterministic end state, no crashes).  
   - Interleaved add + groom (future).  
   - Simulated partial write (future when atomicity gaps removed) -> ensure loader error not disappearance.
5. Property-Based / Fuzz  
   - Instruction generation explores category normalization, priority tier derivation, deterministic hashing.  
   - Future: corpus of malformed JSON, truncated files, schema edge cases to assert they surface in `loadErrors` not silent skip.
6. Governance Drift / Integrity  
   - Hash stability tests assert no change when unrelated fields mutate.  
   - Drift detection only when governance projection changes.

## Expansion Playbook
 
For every new defect class discovered:
1. Reproduce minimal failing scenario manually or via script.  
2. Add failing test in the lowest viable layer (unit < service < protocol).  
3. Fix the code.  
4. Add a regression guard at protocol layer if issue originated from cross-layer interaction.

## Automation Cadence

- All tests: `npm test` (CI).  
- Contract / schema-only quick check: `npm run test:contracts`.  
- Coverage gate: `npm run coverage:ci` (threshold lines / branches).

## Property-Based Guidance

- Keep each property < 100 runs for CI speed; add nightly job (future) with >1000 runs.  
- Shrink failure outputs to produce minimal counter-example (default fast-check behavior).  
- Prefer focused arbitraries: supply only valid characters to avoid noisy schema rejections.

<!-- Historical parked property-based backlog removed as part of plan reset (see new Implementation Plan). -->

## Pending Enhancements

- Add `loadErrors` tool and tests: assert no silent skips.  
- Atomic write enforcement test: inject crash between write & fsync (requires harness).  
- Path pinning test after directory resolution refactor.  
- Fuzz loader with truncated JSON files, expect surfaced errors.

## Principles

- Each new bug gets a test before a fix.  
- Never broaden a property until it finds at least one real issue historically (evidence-driven expansion).  
- Keep protocol tests deterministic (avoid racey timing; prefer polling wait utilities).  
- Fast feedback: majority of suite under 10s local.

## Mandatory CRUD Feedback Red/Green Workflow (Mirrored Policy)

This section mirrors the authoritative policy in `FEEDBACK-DEFECT-LIFECYCLE.md` and is included here so test authors have zero ambiguity when confronted with CRUD / persistence anomalies (phantom writes, visibility gaps, inconsistent list vs get, multi-client divergence).

High-level enforcement (concise):

1. RED test first (`*.red.spec.ts`) using ONLY reporter-provided IDs.
2. No handler/service code changes until RED test committed & failing in CI.
3. RED test MUST assert: add contract, list inclusion, per-ID get visibility, catalog hash (or synthetic surrogate) mutation.
4. Capture evidence (counts, missing IDs) in an analysis doc before any fix.
5. Apply minimal atomic persistence fix (write → verify → index update) then convert RED to GREEN (rename/duplicate).
6. Add negative + multi-client visibility regression tests post-fix.
7. CI guard: CRUD issue closure requires RED→GREEN pair reference.

### Data Fidelity Enforcement (ALWAYS Use Provided Data)

ALL reproduction tests MUST embed or import the exact reporter-supplied payload (every field & original whitespace). No trimming, reformatting, synthesized IDs, or markdown reflow unless an inline `DATA-FIDELITY-WAIVER` comment references explicit approval & rationale. Reviewers reject any PR that paraphrases payload content. Future automation will lint for divergence against archived feedback JSON.

Refer to the lifecycle doc for the detailed invariant table and justification. Any deviation requires explicit documented waiver in both docs.
