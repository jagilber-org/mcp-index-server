# Governance & Hash Integrity Test Plan

Objective: Add deterministic test coverage for instruction governance invariants and content-hash stability now that CRUD baseline is green and parse‑error noise eliminated.

## Scope

- Hash generation stability across create → read → update sequences
- Governance directives: persistence, overwrite protection, idempotency flags
- Detection of hash drift when body changes vs when metadata-only changes occur (title / categories)
- Enforcement of immutable fields (id) and controlled mutability (body allowed, hash changes; title optional)
- Cross-run reproducibility: same body => same hash; changed body => different hash

## Non-Goals (initial phase)

- Cryptographic algorithm implementation tests (treat hashing as black box, assert behavioral contracts)
- Performance micro-benchmarks (covered elsewhere)

## Test Matrix

| Test | Description | Key Assertions |
|------|-------------|----------------|
| hash-on-create | Create instruction; capture hash | hash not null; matches read hash |
| hash-on-update-body | Update body; hash changes | newHash !== oldHash; list reflects newHash |
| hash-stability-metadata-update | Update title only | hash unchanged |
| multi-create-consistency | Create same body twice with different ids | hashes equal (same content) |
| overwrite-flag-governed | Create id twice without overwrite | second create returns skipped/overwritten flag without changing original hash |
| overwrite-explicit | Create id then force overwrite | new hash differs when body differs |
| drift-detection-sequence | Simulate body change; verify hash difference appears exactly once | sequence of hashes has exactly 2 unique values |

## Edge Cases

- Empty body rejection (if enforced)
- Very large body (baseline only; ensure hash returns quickly)
- Rapid successive updates (stability under quick mutation)

## Implementation Notes

- Reuse portable client shim (createInstructionClient)
- Add small helper: computeHash(id) via client.read(id) extracting item.hash
- Poll after update (existing pattern) until hash changes or timeout
- Use deterministic bodies with timestamp suffix only when asserting inequality; for equality tests use fixed static body strings

## Failure Diagnostics

On assertion failure, emit diagnostic object: { phase, id, prevHash, newHash, bodySnippet }

## Next Steps

1. Implement helper in test utils (src/tests/utils/hashHelpers.ts)
2. Add spec file: src/tests/governanceHashIntegrity.spec.ts (initially skipped until committed)
3. Run locally, ensure green + no added lint noise
4. Remove .skip once stable over 3 consecutive runs

## Exit Criteria

- All new tests green 3 consecutive build:verify cycles
- No additional eslint parse errors introduced
- Hash behavior differences intentionally documented in README governance section (TODO)
