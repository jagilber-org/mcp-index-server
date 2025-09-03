# DEPRECATED - This document has been consolidated into PROJECT_PRD.md

**⚠️ NOTICE: This document is deprecated as of December 28, 2024**

This PRD has been consolidated into the comprehensive [`PROJECT_PRD.md`](./PROJECT_PRD.md) document which serves as the single authoritative product requirements document for the MCP Index Server project.

Please refer to [`PROJECT_PRD.md`](./PROJECT_PRD.md) for all current requirements, specifications, and governance standards.

---

*Original content preserved below for historical reference only*

---

Provide robust, deterministic, and queryable instruction indexing for AI assistant governance and developer tooling. 0.9.0 advances the platform by introducing schema v2 with persisted `reviewIntervalDays` (decoupling future heuristic shifts) and placeholder archival support while preparing for scalable search & filtering (categories, provenance) without destabilizing existing governance hashing or integrity guarantees.

## 2. Goals (Must-Haves)

1. Schema v2 migration (automatic, idempotent) adding `reviewIntervalDays`, reserving `archivedAt`.
2. Zero governance hash drift for unchanged governance metadata.
3. Deterministic load + migration (one rewrite max per legacy file).
4. Persisted review cadence enabling future heuristic evolution without retroactive churn.
5. Search/filter design (post-bump) enabling server-side filtered retrieval by category & provenance (createdByAgent, sourceWorkspace) – design finalized; implementation may land next minor.
6. Complete test coverage for migration, idempotence, and governance hash stability.

### 2.a Dispatcher Augmentation (Amendment for 0.9.0 Breaking Change)

- Replace fragmented `instructions/*` methods with single `instructions/dispatch` (actions: list, listScoped, get, search, diff, export, import, add, remove, reload, groom, repair, enrich, governanceHash, governanceUpdate, query, categories, dir, inspect, health, capabilities, batch).
- Remove legacy methods (hard break). Clients must migrate; meta/tools exposes only the dispatcher (plus non-instruction tools like prompt/review, usage/*, metrics, integrity, gates, etc.).
- Provide batch semantics: `{ action:'batch', operations:[ { action:'get', id:'alpha' }, ... ] } -> { results:[ ... ] }` with per-operation isolation.
- Provide capabilities: `{ action:'capabilities' } -> { version:'0.9.0', supportedActions:[...], mutationEnabled:true|false }`.
- Enforce mutation gating per action (reuse existing guards) with unchanged error codes.
- Target dispatcher overhead: <5ms p95 vs prior direct method path.
- Testing: route coverage, batch mixed outcomes, governance prerequisites via dispatcher, mutation gating, unknown action error (-32601 with data.action).
- Rationale: Shrink tool surface for simpler client UX, enable evolvable sub-action taxonomy without manifest churn, add atomic batching.

## 3. Stretch Goals (Nice-to-Have)

- Read-only `instructions/search` tool with multi-filter intersection (category, createdByAgent, sourceWorkspace, owner, priorityTier, reviewIntervalDays range) + pagination.
- `instructions/categories` distinct category enumeration.
- README and TOOLS updates reflecting new filters.

## 4. Non-Goals

- Full-text fuzzy / semantic body search (future specialized index).
- Governance projection expansion (kept stable intentionally).
- Archival workflow (setting `archivedAt`) – deferred.
- Write-time advanced validation rules beyond current schema + classification.

## 5. Users & Use Cases

| User | Need | Example |
|------|------|---------|
| Governance Engineer | Detect policy metadata drift | Compare governance hash pre/post release |
| Platform Engineer | Bulk query high-priority items | Filter P1 instructions for reporting |
| AI Orchestrator | Fast fetch by category subsets | Retrieve only `security` + `performance` categories |
| Compliance Ops | Schedule review waves | Use persisted `reviewIntervalDays` vs recalculated heuristic |
| Tooling Client | Determine provenance | Query by `createdByAgent` for attribution dashboards |

## 6. Functional Requirements

### 6.1 Migration

- R1: On load, entries with schemaVersion != '2' are migrated in-memory then persisted (single write) if mutation enabled.
- R2: Migration fills `reviewIntervalDays` if absent using existing tier/requirement derivation.
- R3: Migration does NOT modify governance projection fields (id,title,version,owner,priorityTier,nextReviewDue,semanticSummarySha256,changeLogLength).
- R4: Re-run (same process or restart) causes zero further rewrites.

### 6.2 Normalization

- R5: If `reviewIntervalDays` present, classification preserves value (no recompute).
- R6: If absent (new entry), classification computes and sets it before persistence.

### 6.3 Search (Design Baseline)

- R7: Provide intersection-based filtering (categoryIncludes[], createdByAgent, sourceWorkspace, workspaceId, userId, teamId, owner, priorityTier, reviewIntervalDays >= / <=, ids[] list) – all optional.
- R8: Pagination: `limit` (default 100, max 500) + `cursor` (last id). Stable ordering by id.
- R9: Response: `{ items, total, returned, nextCursor, appliedFilters }`.
- R10: Deterministic results across identical catalog state.

### 6.4 Performance

- R11: Migration pass O(n) with n ≤ 10k baseline; target <150ms cold start at 10k entries.
- R12: Single-filter search O(k) where k = result size (plus index lookup O(1)).
- R13: Multi-filter search uses smallest candidate set first (expected sub-linear reduction vs full scan).

### 6.5 Integrity & Hashes

- R14: Governance hash identical pre/post migration for unchanged governance metadata.
- R15: Integrity verification passes (no unexpected issues) after migration.

### 6.6 Tooling Contracts

- R16: New schema version reflected in `instructions/list`, `instructions/diff`, search (future) responses.
- R17: Search endpoint (when implemented) is read-only (no gating by MCP_ENABLE_MUTATION).

## 7. Data Model (Delta)

Added (v2):

```ts
reviewIntervalDays?: number; // persisted review cadence
archivedAt?: string;         // optional future archival timestamp
```

Unchanged governance projection field set.

## 8. Migration Flow


1. Load raw JSON.
2. If schemaVersion != 2 → compute reviewIntervalDays if missing.
3. Write back updated JSON (pretty stable formatting) if mutation enabled.
4. Proceed to classification (which now trusts existing reviewIntervalDays).

## 9. Secondary Index Strategy (Search Phase)

In-memory maps (built after migration + classification):

- byCategory: Map<string, Set<id\>>
- byCreatedByAgent: Map<string, Set<id\>>
- bySourceWorkspace: Map<string, Set<id\>>

Intersection order heuristic: ascending candidate set size.

## 10. API Specifications (Planned)

### 10.1 instructions/search (POST JSON-RPC)

Input params fields (all optional):

```ts
ids?: string[]
categoryIncludes?: string[]
createdByAgent?: string
sourceWorkspace?: string
workspaceId?: string
userId?: string
teamId?: string
owner?: string
priorityTier?: 'P1'|'P2'|'P3'|'P4'
reviewIntervalDaysMin?: number
reviewIntervalDaysMax?: number
limit?: number
cursor?: string // last id from prior page
```

Response:

```ts
{
  items: InstructionEntry[],
  total: number,
  returned: number,
  nextCursor?: string,
  appliedFilters: string[]
}
```

Errors: -32602 for invalid filter combos (e.g., reviewIntervalDaysMin > Max), -32603 internal.

### 10.2 instructions/categories (optional)

Response: `{ categories: { name: string; count: number }[], totalDistinct: number }` sorted by `name`.

## 11. Success Metrics

## 11. API Surface (Dispatcher Consolidated)

All read-only and mutation catalog operations are now accessed via a single tool `instructions/dispatch` with an `action` discriminator.

| Action | Type | Notes |
|--------|------|-------|
| list | Read | `{ action:'list', category? } -> { hash,count,items }` |
| listScoped | Read | Scoped selection user > workspace > team > all |
| get | Read | `{ id }` returns `{ hash,item }` or `{ notFound:true }` |
| search | Read | Substring baseline; may evolve to advanced filters (use `query` for multi-filter) |
| diff | Read | Incremental sync (added/updated/removed) or `{ upToDate:true }` |
| export | Read | Optional `ids[]`, `metaOnly` stripping bodies |
| query | Read | Advanced multi-filter & pagination (categoriesAny/All/exclude, tier, requirement, priority bounds, text) |
| categories | Read | Distinct categories with counts |
| dir | Read | On-disk file listing diagnostics |
| capabilities | Read | `{ version, supportedActions, mutationEnabled }` |
| batch | Read | `{ operations:[ { action: ... }, ... ] } -> { results:[ ... ] }` per-op isolation |
| add | Mutation | Create/update single entry (lax defaults) |
| import | Mutation | Bulk import (skip/overwrite modes) |
| remove | Mutation | Delete one or more ids |
| reload | Mutation | Re-scan catalog from disk |
| groom | Mutation | Normalize, merge duplicates, purge legacy scopes |
| repair | Mutation | Fix incorrect stored body hashes |
| enrich | Mutation | Persist missing computed governance fields |
| governanceHash | Read | Stable governance projection hash |
| governanceUpdate | Mutation | Controlled patch + optional semver bump |
| health | Read | Snapshot drift vs canonical baseline |
| inspect | Read | Deep per-file diagnostics (raw + normalized) |

Other top-level tools (unchanged): `integrity/verify`, `prompt/review`, `usage/track`, `usage/hotset`, `usage/flush`, `metrics/snapshot`, `gates/evaluate`, `meta/tools`.

Legacy methods (`instructions/list`, `instructions/get`, etc.) removed in 0.9.0.

- M1: Governance hash unchanged across v1→v2 migration (100% of test corpus).
- M2: 0 regression test failures; new migration tests pass.
- M3: Startup time increase <10% vs prior baseline at 2k entries (target metric placeholder).
- M4: Search prototype (if implemented in same release) returns ≤100ms P95 for single-category filter at 10k entries on reference hardware.

## 12. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| Hash drift due to unintended projection change | Breaks snapshot comparisons | Low | Explicit hash stability test |
| Performance regression from added indices | Slower startup | Low | Lazy-build or measure before enabling search release |
| Non-idempotent migration rewriting repeatedly | File churn | Low | Idempotence test validation |
| Over-broad search causing heavy memory usage | Memory pressure | Medium (future) | Hard result limits + streaming pagination (future) |

## 13. Testing Strategy

- Unit: migration function path (v1 → v2), classification preserving reviewIntervalDays.
- Integration: load + migrate + governance hash comparison.
- Idempotence: second load no writes (mtime stable or migration notes absent).
- Negative: invalid filter argument combinations yield -32602.
- Performance (optional): measure migration duration on synthetic corpus (script).

## 14. Rollout Plan

1. Implement migration + schema change + tests.
2. Verify governance hash stability on real instruction set.
3. Update docs (MIGRATION, ARCHITECTURE, VERSIONING, CHANGELOG).
4. Bump version to 0.9.0.
5. Tag & release.
6. (Optional) Implement search in 0.9.x minor once indices validated.

## 15. Backward Compatibility

- Older clients ignore new fields; rollback safe (unused extras).
- No removal of prior fields; additive only.

## 16. Open Questions

- Should `archivedAt` eventually influence governance hash? (Currently no; future governance v2.)
- Need separate tool for listing distinct owners? (Out of scope.)
- Introduce server capability enum for search? (Likely yes when implemented.)

## 17. Appendices

- Architecture: `ARCHITECTURE.md` (updated component flow).

---
End of PRD.
