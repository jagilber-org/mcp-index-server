# Archived Property-Based & Add-Back Test Plan (Parked)

> ARCHIVED / CONSOLIDATED: This file is retained for historical context only.
> The active, condensed backlog now lives in `TESTING-STRATEGY.md` under
> "Parked Property-Based Backlog". Update only that location going forward.

Status at archival: PARKED (coverage low-water mark enforced at 80% lines)

Purpose (historical): Document future expansion of property-based and additive tests once current priorities resume. Provides a ready queue with rationale & expected invariants so work can restart quickly.

## Current Baseline

- Overall coverage (lines): ~82-83% (target floor now 80%).
- Existing property-based suite: `instructionsPropertyBased.spec.ts` (classification normalization invariants, 50 runs).

## Guiding Principles

1. Determinism: Prefer pure function invariants; avoid filesystem/process churn inside property loops.
2. Minimal Shrink Noise: Narrow arbitraries (regex filters) to reduce unhelpful shrinks while preserving diversity.
3. Fast Feedback: Cap long-run suites behind an env flag (`PBT_EXTENDED=1`) so CI default stays quick.
4. Focus on Transform/Projection Layers before I/O heavy mutation paths.

## (Moved) Expansion Backlog

See consolidated table in `TESTING-STRATEGY.md`.

## Implementation Sketches

### Example: Diff Symmetry Property

1. Generate base catalog (list of unique entries with id + body hash).
2. Generate client view by removing/updating random subset; produce known[] snapshot.
3. Invoke diff algorithm (pure re-implementation or via handler under injected fs sandbox).
4. Apply delta to client view; recompute projection; assert equality with server base set ordering independent.

### Example: Groom Idempotence

- Generate entries with probabilistic duplicate bodies & overlapping categories.
- Run groom once (simulate algorithm in-memory) capturing result & metrics.
- Run groom again; assert no further changes.

## Environmental Controls

- Add `FAST_CHECK_NUM_RUNS` env to scale runs (default 30, CI 50, extended 200).
- Long-running (>=200) grouped under vitest `describe.skip` unless `PBT_EXTENDED=1`.

## Tooling Enhancements (Deferred)

- Custom pretty printer for InstructionEntry diffs to aid failing case diagnosis.
- Deterministic seed logging with reproduction hint: `Re-run with FAST_CHECK_SEED=123456`.

## Exit Criteria (When Reactivated)

- Add at least 3 new P1/P2 properties.
- Keep suite runtime increase < +10% vs current baseline under default run counts.
- Maintain line coverage >= 82%, branches >= 68% (stretch) after additions.

## Parking Rationale

Immediate effort shifted to other deliverables; baseline reliability achieved and guarded by 80% floor.

## Reactivation Checklist

- Confirm no major refactors pending in targeted modules.
- Unpark P1 properties first with focused PR.
- Monitor runtime delta; adjust run counts if CI timeouts risk increases.

---
(End of parked plan)
