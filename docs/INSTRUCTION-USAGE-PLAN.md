# INSTRUCTION USAGE INSTRUMENTATION & GROOMING ENABLEMENT

Authoritative single active plan; supersedes prior *PLAN* docs.

---

## 1. Objective

Track real-world instruction consumption (get/list/add/remove/searchHit) with negligible user latency, enabling data-driven grooming (retain, review, deprecate).

## 2. Scope

IN: Client-side enqueue + batch flush; scoring heuristic; governance signals; minimal metrics.

OUT: Server persistence changes (assume endpoint exists / feature can be toggled later); UI dashboards.

## 3. Non-Goals

- Real-time popularity ranking.
- Per-user behavioral analytics.
- Retroactive backfill.

## 4. Architecture (Client-Side)

```text
   +-----------------------------+
   | Instruction Access Layer    |
   | (list/get/add/remove/search)|
   +--------------+--------------+
                  | fire event
                  v
   +-----------------------------+
   | UsageEventFactory           |
   +-----------------------------+
                  | enqueue
                  v
   +-----------------------------+
   | In-Memory Ring Buffer Queue |
   | (bounded, lock-free)        |
   +-----------------------------+
                  | flush trigger
                  v
   +-----------------------------+
   | Batch Aggregator            |
   | - de-dup window (60s)       |
   | - coalesce same id+action   |
   +-----------------------------+
                  | POST /usage/batch (async)
                  v
   +-----------------------------+
   | Best-effort Retry (jitter)  |
   +-----------------------------+
```

## 5. Data Model (Event)

```jsonc
{
   // Unique instruction identifier (file path or logical id)
   "instructionId": "string",
   // Action performed
   "action": "get" | "list" | "add" | "remove" | "searchHit",
   // UTC timestamp in ISO8601
   "tsUtc": "2025-09-03T10:15:30.123Z",
   // Optional stable, anonymized client hash
   "clientId": "sha256(seed|machine|session)",
   // Schema / versioning for forward compatibility
   "version": "1",
   // Optional catalog hash at the moment of access
   "contextHash": "<catalog-hash>"
}
```

## 6. Batch Model

```jsonc
{
   "batchId": "guid",
   "generatedUtc": "2025-09-03T10:15:35.000Z",
   "events": [ /* UsageEvent[] */ ],
   "count": 42
}
```

## 7. Scoring Heuristic (Rolling)

Windows: W30 (0–30d), W60 (31–60d), W90 (61–90d)

Formula:

```text
score = (W30 * 1.0) + (W60 * 0.5) + (W90 * 0.25)
```

Rules:

- Decay applied daily by shifting window buckets.
- Zero score for >2 review intervals => archive candidate (unless protected).

## 8. State Tracked (Local Cache)

- accessCountTotal
- lastAccessUtc
- windowBuckets {30d,60d,90d} counts
- protectedFlag (from instruction metadata requirement=mandatory or tag)
- firstSeenUtc

## 9. Flush Triggers

- queue length >= MAX_EVENTS (e.g., 25)
- oldest event age >= MAX_AGE_SEC (e.g., 5s)
- on idle / shutdown
- manual flush (dev/testing)

## 10. Performance Targets

- Enqueue time: < 0.25 ms
- Added synchronous path latency: 0 ms (fire-and-forget)
- Memory ceiling: < 64 KB typical (bounded queue)
- Lost events acceptable threshold: < 2% (during failures)

## 11. Failure Modes & Handling

| Failure Case            | Strategy                       |
|-------------------------|---------------------------------|
| Network timeout         | Retry w/ backoff (1s,2s,5s)     |
| Server disabled feature | Cache flag -> suspend sends     |
| Queue overflow          | Drop oldest (log counter)       |
| Serialization error     | Skip batch; increment metric    |
| Process crash           | Ephemeral loss (acceptable)     |

## 12. Config Knobs

```env
# Master enable (feature flag)
USAGE_ENABLED=true

# Flush triggers
MAX_EVENTS=25
MAX_AGE_SEC=5
DEDUP_WINDOW_SEC=60

# Retry controls
RETRY_LIMIT=3
RETRY_BACKOFF_MS=1000,2000,5000

# Governance protections
PROTECTED_TAGS=mandatory,must,core
```

## 13. Security / Privacy

- Hash client identifiers (no raw user identity).
- No instruction body content transmitted.
- Avoid correlating sequential fetch timing (no high-res per-user tracking).

## 14. Instrumentation Points

```ts
wrapInstructionGet(id)        // record get
wrapInstructionList()         // record list (one event, not per item)
wrapInstructionAdd(id)        // record add
wrapInstructionRemove(id)     // record remove
search(term) -> results       // record searchHit per distinct instructionId (cap 10 per search)
```

## 15. Batch Aggregation Rules

- Coalesce identical (instructionId, action) within DEDUP_WINDOW_SEC keeping earliest tsUtc.
- Maintain occurrenceCount for diagnostic (optional).
- On flush: expand or include count field (optional countOnly mode).

## 16. Metrics (Local)

Counters:

- usage.enqueue.success
- usage.enqueue.dropped
- usage.flush.sent
- usage.flush.failed
- usage.event.coalesced

Gauges:

- usage.queue.length
- usage.queue.oldestAgeSec

Derived:

- usage.loss.percent (dropped / (dropped + sent))

## 17. Grooming Decision Matrix

| Condition                                        | Action                    |
|--------------------------------------------------|---------------------------|
| score == 0 AND age > 2*reviewInterval            | Archive candidate         |
| score rising > 50% vs prior interval             | Prioritize review earlier |
| high riskScore (>=90) AND high score             | Accelerate review         |
| mandatory & low score                            | Keep (no action)          |
| duplicated intent + low score                    | Merge / deprecate         |

## 18. Rollout Phases

| Phase | Description                                  |
|-------|----------------------------------------------|
| 0     | Feature flag scaffolding (no-op hooks)        |
| 1     | Enqueue + debug log (verify counts)           |
| 2     | Async flush to dummy endpoint / dry-run       |
| 3     | Production endpoint + metrics summary         |
| 4     | Scoring job integration (daily)               |
| 5     | Automated grooming report generation          |
| 6     | Policy enforcement (archive suggestions)      |

## 19. Time Estimate (Engineering)

| Segment  | Estimate |
|----------|----------|
| Phase 0–2| 2 hrs    |
| Phase 3  | 1 hr     |
| Phase 4  | 1 hr     |
| Phase 5  | 1.5 hrs  |
| Phase 6  | 2 hrs    |
| Total (through Phase 5)| ~5.5 hrs |

## 20. Acceptance Criteria

- <1 ms median added latency per instruction access
- 95% of accesses produce an event (without featureDisabled)
- Flush reliability: ≥98% success in normal network conditions
- Scoring table generated daily (size = instruction count)
- Grooming report lists: stale[], trending[], protected[]
- No PII or instruction body leakage

## 21. Pseudocode (Abbreviated)

```ts
interface UsageEvent {
   instructionId: string;
   action: 'get'|'list'|'add'|'remove'|'searchHit';
   tsUtc: string; // ISO8601
   clientIdHash?: string;
   version: '1';
}

class UsageQueue {
   // ring buffer omitted for brevity
   enqueue(e: UsageEvent) {
      // feature flag, dedup, capacity checks
   }
   triggerFlush() {/* batching + async post */}
}

function isDuplicate(e: UsageEvent): boolean {
   // windowed key suppression
   return false;
}
```

## 22. Daily Scoring Job (Logic)

Algorithm:

1. Shift window buckets (move older counts downward)
2. Add todayCount to W30
3. Recompute score
4. Export CSV: instructionId, score, lastAccessUtc, accessCount30, accessCount60, accessCount90, protectedFlag

## 23. Grooming Report Format (Text)

Sections:

```text
== STALE CANDIDATES ==
{id} | lastAccess: {date} | risk: {riskScore}

== TRENDING UP ==
{id} | scoreDelta: +x% | lastAccess: {date}

== PROTECTED LOW USAGE ==
{id} | protectedTag | score=0
```

## 24. Risk Mitigation

- Feature flag kill switch (env var)
- Hard queue size cap
- Silent degrade on POST failures
- Version field for forward-compatible decoding

## 25. Extensibility

Future fields: actionSource (api|ui|automation), sessionCorrelationId

Potential server push: popularity snapshot to client for UX ordering

Anomaly detection: spike vs moving average

## 26. Validation Checklist (Implementer)

- [ ] Feature flag off ⇒ zero outbound calls
- [ ] Feature flag on + mock endpoint ⇒ events aggregated
- [ ] Dedup logic suppresses rapid repeat (manual test)
- [ ] Forced shutdown flush sends remaining events
- [ ] Retry stops after RETRY_LIMIT
- [ ] Score generation matches manual calculation sample
- [ ] Grooming report surfaces expected stale test entries

## 27. Deferred (If Not Needed Immediately)

- Persistent local spill (disk) for crash resilience
- Compression of large batches
- Differential privacy adjustments

## 28. Abort Criteria

- If featureDisabled persists server-side >30 days
- If measured overhead >5 ms p95 (investigate or disable)
- If event loss >10% over rolling 7d

## 29. Summary

Lightweight async event capture + rolling window scoring enables objective grooming with trivial engineering cost (<1 day) and negligible runtime impact.

## Progress Tracking

| Phase | Description                                  | Status |
|-------|----------------------------------------------|--------|
| 0     | Feature flag scaffolding (no-op hooks)       | [ ]    |
| 1     | Enqueue + debug log                          | [ ]    |
| 2     | Async flush to dummy endpoint                | [ ]    |
| 3     | Production endpoint + metrics                | [ ]    |
| 4     | Daily scoring integration                    | [ ]    |
| 5     | Grooming report generation                   | [ ]    |
| 6     | Policy enforcement                           | [ ]    |

Milestones:

- [ ] USAGE_ENABLED flag wired
- [ ] Instrumentation wrappers
- [ ] Queue + dedup unit tests
- [ ] Batch flush + retry
- [ ] Endpoint contract finalized
- [ ] Scoring script producing CSV
- [ ] Grooming report prototype
- [ ] Archive suggestion gating

---
End of Plan
