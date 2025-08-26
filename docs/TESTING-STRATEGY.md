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
