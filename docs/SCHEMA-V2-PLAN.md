## Schema v2 Implementation Plan (Authoritative)

Status: APPROVED (supersedes any prior ad‑hoc schema migration notes)

Target Release Version: 0.9.0

### 1. Objectives

- Persist `reviewIntervalDays` to decouple future heuristic changes from stored values.
- Introduce placeholder `archivedAt` (optional) for future archival support without affecting governance hash.
- Maintain governance hash stability (no projection field changes).
- Idempotent, automatic migration on load; zero manual intervention.

### 2. Schema Changes

Additive fields to `InstructionEntry`:

- `reviewIntervalDays?: number` (auto-derived if absent during migration from tier + requirement)
- `archivedAt?: string` (ISO timestamp; omitted unless explicitly set)

No removal or renaming of existing fields.

### 3. Governance Hash Impact

Unchanged projection field set: `id,title,version,owner,priorityTier,nextReviewDue,semanticSummarySha256,changeLogLength`.
Adding new fields does NOT alter governance hash; migration must not touch those projection values except schemaVersion.

### 4. Migration Logic (v1 -> v2)

File: `src/versioning/schemaVersion.ts`

1. Detect previous version: `prev = rec.schemaVersion || '1'`.
2. If `prev === '1'` and `reviewIntervalDays` missing, compute via same logic currently in `ClassificationService.reviewIntervalDays(tier, requirement)`.
3. Do NOT recompute `nextReviewDue` or other governance fields.
4. Leave `archivedAt` undefined.
5. Set `schemaVersion = '2'`; append note `schemaVersion updated v1->v2`.
6. Mark changed = true if any modification.
7. Idempotent: subsequent passes with version `2` produce no changes.

### 5. Classification Adjustments

File: `src/services/classificationService.ts`

- When normalizing, respect existing `reviewIntervalDays` (do not recompute if present).
- Only compute if absent.
- Continue deriving `nextReviewDue` only if not already set (unchanged behavior).

### 6. Handlers

File: `src/services/handlers.instructions.ts`

- New entries: ensure they flow through classification to assign `reviewIntervalDays`.
- No direct code path changes beyond schema bump constant.

### 7. Tests

Add:

1. `schemaMigrationV2.spec.ts`
   - Create temp instruction with `schemaVersion: '1'`, missing `reviewIntervalDays`.
   - Load (mutation enabled) -> assert file rewritten with `schemaVersion: '2'`, `reviewIntervalDays` present (>0), governance hash unchanged (capture before/after if feasible in-memory vs persisted reload).
2. `reviewIntervalPersistence.spec.ts`
   - Create instruction; capture `reviewIntervalDays`.
   - Simulate change to priority (without deleting field) and reload; verify `reviewIntervalDays` unchanged (persistence honored).
3. `migrationIdempotence.spec.ts`
   - Load migrated entry a second time; confirm no rewrite (e.g., timestamp / mtime stable) and no additional migration notes.

Update:

1. `schemaVersion.spec.ts` -> expect `SCHEMA_VERSION === '2'`.
2. `governanceHashStability.spec.ts` (or new assertion) -> adding `reviewIntervalDays` does not alter hash.

### 8. Docs & Changelog

- `docs/MIGRATION.md`: Add 0.9.0 section describing schema v2 additions & zero hash impact.
- `docs/VERSIONING.md`: Append rationale summary.
- `docs/ARCHITECTURE.md`: Mention persisted `reviewIntervalDays` and placeholder `archivedAt`.
- `CHANGELOG.md`: `feat(schema): bump to v2 adding reviewIntervalDays and archivedAt placeholder (non-governance)`.

### 9. Rollout Steps

1. Implement code changes & tests.
2. Run full test suite (expect all green).
3. Verify governance hash pre/post (script: compute before changing branch; after bump confirm identical).
4. Bump package version to 0.9.0.
5. Merge & tag.

### 10. Backward Compatibility

- Older versions ignore new fields; rollback safe (fields treated as unknown extras).
- No destructive transformations; only additive.

### 11. Failure Modes & Mitigations

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Logic drift between migration and classification for interval calc | Inconsistent intervals | Centralize identical helper used in both; unit test equality |
| Unintended governance hash change | Breaks determinism | Explicit test comparing hash before/after migration |
| Repeated rewrites (non-idempotent) | Performance + churn | Idempotence test ensures one-time rewrite |

### 12. Helper Extraction

Add pure function `computeReviewIntervalDays(tier, requirement)` exported from `classificationService` or a new utility to avoid duplication.

### 13. Non-Goals (Deferred)

- Archive tool (`instructions/archive`) implementation.
- Search/filter tools by `reviewIntervalDays` or `archivedAt`.
- Governance projection evolution.

### 14. Acceptance Criteria

- All existing tests pass after bump.
- New tests covering migration, idempotence, hash stability pass.
- Governance hash unchanged for unchanged governance fields.
- No additional file rewrites on second load.

### 15. Quick Reference

- New version constant: `SCHEMA_VERSION = '2'`.
- New fields: `reviewIntervalDays`, `archivedAt?`.
- Projection unchanged.
- Migration: single-step v1 -> v2, additive only.

---
This document supersedes previous informal schema migration planning; treat it as the canonical source.

### 16. Planned Search/Filter Extensions (Post-Bump)

Scope: Add read-only tools to query instructions by category and by source/client provenance without altering schema v2.

Existing Provenance Fields:

- `createdByAgent`: Identifier of the MCP agent/client that created the instruction (serves as a logical "client" field).
- `sourceWorkspace`: Logical workspace/project identifier at creation time (acts as a "source" indicator).
- `workspaceId` / `userId` / `teamIds`: Derived scoping fields (may appear via category normalization).
- Categories themselves (normalized lowercase list) already persisted.

Planned Tool Additions (read-only):

- `instructions/search` (new): Supports filters: `ids[]`, `categoryIncludes[]`, `createdByAgent`, `sourceWorkspace`, `workspaceId`, `userId`, `teamId`, `priorityTier`, `reviewIntervalDays(<=,>=)`, `owner`, pagination (`limit`, `cursor`).
- `instructions/categories` (optional helper): Returns distinct category list + counts for discoverability.

Indexing Strategy:

- Build secondary in-memory maps on load/mutation: `byCategory: Map<string, Set<id>>`, `byCreatedBy: Map<string, Set<id>>`, `bySourceWorkspace: Map<string, Set<id>>`.
- Intersection-based query planner chooses smallest candidate set first (category → createdByAgent → sourceWorkspace → scan fallback).
- Complexity: O(k) where k = result size + small overhead for set intersections; rebuild cost O(n * avgCategories) on reload.

API Determinism:

- Responses sorted by `id` unless client supplies explicit `sort` (future extension: `priorityTier` or `updatedAt`).
- Include `total`, `returned`, `nextCursor` for pagination (stable cursor = last id of current page).

Governance Hash Impact:

- Purely read-only; indices not serialized; no projection change.

Security / Gating:

- No mutation; available without `MCP_ENABLE_MUTATION`.
- Hard limit `limit <= 500` per call; default 100.

Future Considerations:

- Add archived filtering once `archivedAt` utilized.
- Add full-text body search (deferred; would require separate index or simple scan with throttle).

Acceptance (for search feature milestone):

- Queries with single filter O(k) and <50ms at 10k entries.
- Intersections correct & deterministic ordering.
- Pagination stable across unchanged catalog.
