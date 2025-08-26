# Current Plan: Gradual Reintroduction of Index Properties

Goal: Reintroduce previously removed or disabled instruction index properties (e.g. usage, temporal metadata, hotness) in a controlled, low‑risk manner that preserves stability and performance while adding measurable value.

Key Principles

- Incremental: Add one cohesive property family per phase behind feature flags.
- Observable: Each property emits metrics (activation, update counts, error counts).
- Reversible: Single env flag or config toggle disables updates without code changes.
- Low Overhead: Added CPU/time per mutation stays within defined budget (<5% over baseline per phase).
- Deterministic Persistence: Each new property either computed on access (derived) or stored atomically with existing instruction record updates.

Target Properties (Families)

1. Usage Core: usageCount, firstSeenTs, lastAccessTs
2. Temporal Windowing: last24hAccessCount, last7dAccessCount (rolling decay or time-bucketed)
3. Hotness / Ranking: hotScore (function of recent vs total usage)
4. Integrity / Drift: sourceHash (already present), governanceHash (projection) surfaced in list responses
5. Classification Confidence: confidence score (optional; derived only at request time initially)
6. Risk & Policy Signals: riskScore (pure function of normalized content) cached

Phase Overview
Phase 0 (Preparation)

- Add feature flag infrastructure: INDEX_FEATURES=usage,window,hotness,etc (CSV) with helper predicate hasFeature(name).
- Add metrics counters: featureActivated{name}, propertyUpdate{name}, updateErrors{name}.
- Baseline performance snapshot (mutation + list operations).

Phase 1 (Usage Core)

- Implement in-memory usage tracking keyed by id; persist lazily (batch flush every N seconds or M mutations, whichever first) to minimize write amplification.
- On instruction read (get/list/inspect) increment usage if feature enabled.
- Persist fields into instruction JSON (add/update shape) under metadata.usage.
- Tests: unit (increment logic), integration (add->get increments), persistence (restart retains counts), concurrency (fused increments under parallel reads).
- Guardrails: Max increments per second per id (simple rate limiter) to avoid runaway from tight loops.

Phase 2 (Temporal Windowing)

- Introduce time-bucket ring (e.g. 24 hourly buckets + 7 daily buckets) stored in a sidecar file usage-buckets.json (atomic write) to avoid bloating each instruction file.
- Derived counts projected on read; not stored per-instruction to keep files small.
- Metrics: bucketRollovers, bucketCompactions.
- Tests: bucket advance simulation, daylight savings neutrality (UTC timestamps only).

Phase 3 (Hotness / Ranking)

- Compute hotScore = f(recentWeight * last24h + decay(last7d), log(totalUsage)).
- Expose via new tool instructions/hotset returning top K ids.
- Cache hotScore snapshot recomputed every T seconds; invalidate on bucket rollover.
- Tests: deterministic ordering given fixed counts, stability with no updates.

Phase 4 (Integrity & Drift Surfacing)

- Ensure governanceHash & sourceHash are always present; add drift flag if stored hash != recomputed.
- Add instructions/integrity tool enumerating drifted entries.
- Tests: manual file tamper triggers drift flag.

Phase 5 (Classification Confidence & Risk)

- Compute confidence & riskScore lazily and memoize; flush memo on content change.
- Add feature flag gating riskScore updates separately for performance tuning.
- Tests: risk monotonicity invariants (adding risk tokens does not lower score).

Phase 6 (Optimization & Hardening)

- Adaptive flush thresholds: increase batch size if write time < budget; decrease if latency spikes.
- Background compaction for obsolete buckets.
- Cleanup script to remove orphan sidecar entries.

Data Model Changes

- Instruction JSON: add metadata.usage = { total, firstSeenTs, lastAccessTs, lastFlushTs? }
- Sidecar usage-buckets.json: { hourly: {bucketStartEpoch, counts: number[24]}, daily: {dayStartEpoch, counts: number[7]} }

Feature Flags & Env

- INDEX_FEATURES=usage,window,hotness,drift,risk
- INDEX_USAGE_FLUSH_INTERVAL_MS (default 5000)
- INDEX_USAGE_FLUSH_BATCH (default 100 updates)
- INDEX_HOTSET_RECOMPUTE_MS (default 10000)

Success Metrics

- Phase 1: <5% mutation latency increase (p95) vs baseline; zero data loss across restart test.
- Phase 3: Hotset request p95 < 20ms at 10k entries.
- Drift integrity tool: O(n) scan completes < 1s at 5k entries.

Rollback Strategy

- Removing feature name from INDEX_FEATURES halts new updates; persisted fields remain inert.
- Emergency kill: INDEX_FEATURES= (empty) + server restart.
- Provide admin/featureStatus tool enumerating active flags & counters.

Testing Additions

- New test file: usageTracking.spec.ts (Phase 1)
- New test file: usageBuckets.spec.ts (Phase 2)
- New test file: hotsetRanking.spec.ts (Phase 3)
- Reuse existing fuzz harness with added mode generating random access patterns.

Open Questions (Resolve in Phase 0)

1. Do we rewrite instruction JSON on every read increment? (Answer: no, batch flush.)
2. Accept eventual consistency window for usage? (Yes, up to flush interval.)
3. Need per-user usage? (Defer; current scope global aggregate.)

Out of Scope (for this plan)

- Per-user attribution
- Real-time streaming updates
- Advanced decay functions (beyond exponential or linear blend)

Immediate Next Actions (Phase 0 Execution)

1. Introduce feature flag parser & hasFeature helper.
2. Add metrics counters & baseline snapshot script.
3. Write usage tracking service skeleton (in-memory map + flush stub).
4. Add admin/featureStatus tool.
5. Create test scaffolds (skipped) for upcoming phases.

Once Phase 0 PR merged, proceed with Phase 1 implementation.
