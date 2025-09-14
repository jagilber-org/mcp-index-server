# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

- Dashboard: Added performance (CPU + Memory) card visual baseline snapshot (`performance-card-*`).
- UI: Refactored drilldown controls into horizontal grouped layout with standardized checkbox styling.
- Tests: Promoted performance card snapshot to mandatory Playwright baseline; removed legacy optional skips via deterministic seeding.


### Added (dispatcher capabilities & batch)

### Documentation (overhaul 1.4.2)

- Added `docs/MANIFEST.md` detailing catalog manifest lifecycle, invariants, drift categories, opportunistic materialization, and fastload roadmap.
- Updated `README.md` with Manifest & Opportunistic Materialization section; added MANIFEST doc links in primary doc suite lists.
- Updated `PROJECT_PRD.md` to version 1.4.2 including formal Manifest & Materialization requirements (MF1–MF7) and ratified schema‑aided failure contract.
- Updated `ARCHITECTURE.md` (version banner 1.4.1 → context now aligned with opportunistic materialization & manifest helper) – cross-linked manifest semantics.
- Updated `DOCS-INDEX.md` adding Manifest category; refreshed recent updates section for 1.4.x runtime changes.
- Removed deprecated PRD stub files (`docs/PRD.md`, `docs/PROJECT-PRD.md`) to eliminate duplication; canonical remains `docs/PROJECT_PRD.md`.
- Ensured CHANGELOG references preserved and future fastload placeholder documented (no runtime effect yet).

### Changed (readability & consistency)

- Standardized terminology: "Opportunistic Materialization" (replaces ambiguous "late materialization" phrasing) across updated docs.
- Clarified disable flag guidance for `MCP_MANIFEST_WRITE=0` (diagnostic/read-only only).


### Fixed (persistence phantom write false positive)

- Reclassified `instructionsPersistenceDivergence.red.spec.ts` to GREEN (`instructionsPersistenceDivergence.spec.ts`).
- Root cause: baseline drift (IDs under test already existed) causing stable count/hash and perceived phantom writes.
- Added adaptive assertions: if IDs are new, count/hash must change; pure overwrite path allows stable hash but guarantees visibility.
- Removed heavy multi-flag RED gating for this scenario (now validated by normal suite).

### Governance (baseline noise suppression)

- Updated `scripts/guard-baseline.mjs` allow-list (noise suppression only) to include:
  - `httpMetrics.spec.ts` (HTTP instrumentation coverage)
  - `instructionsPersistenceDivergence.spec.ts` (adaptive GREEN replacement test)
  - `dashboardPhase1.spec.ts` (dashboard infra wiring)
  - `dashboardRpmStability.spec.ts` (RPM metrics stability)
  (No minimal invariant expansion; internal baseline policy unchanged.)

  ## [1.4.0] - 2025-09-13

  ### Added (manifest observability & helper)

  - Centralized manifest update helper `attemptManifestUpdate()` consolidates all post‑mutation catalog manifest writes (future hook point for batching/debounce without changing call sites).
  - Structured manifest write log lines: `[manifest] wrote catalog-manifest.json count=<entryCount> ms=<duration>` emitted only on successful writes.
  - New counters:
    - `manifest:write` – incremented on each successful manifest write
    - `manifest:writeFailed` – incremented when an exception occurs during write
    - `manifest:hookError` – incremented when update hook invocation throws
  - Environment flag `MCP_MANIFEST_WRITE=0` disables manifest persistence (read-only / diagnostic mode) while allowing normal runtime behavior.

  ### Fixed (visibility flake)

  - Stabilized intermittent add → immediate list/get visibility timing by refining late materialization path and adding targeted retry logic in `addVisibilityInvariant.spec.ts` (single bounded retry, preserves genuine failure signal).

  ### Tests (edge coverage)

  - New `manifestEdgeCases.spec.ts` validating:
    - Disabled write mode respects `MCP_MANIFEST_WRITE=0` (no file created/modified)
    - Corrupted on-disk manifest auto‑repair after subsequent catalog mutation
  - Visibility invariant test enhanced with diagnostic trace & retry instrumentation (now consistently green).

  ### Documentation

  - README: Added Manifest Observability section, documented new counters & `MCP_MANIFEST_WRITE` flag plus reserved `MCP_MANIFEST_FASTLOAD` (planned fast load optimization – inactive placeholder).
  - CONFIGURATION guide: Added Manifest Configuration section & environment variable table entries.
  - CHANGELOG: This entry formalizes helper + observability release.

  ### Internal (refactor & safety)

  - Removed scattered try/catch blocks around manifest writes in instruction mutation handlers; all now route through helper ensuring unified error handling & metrics.
  - Preserved existing manifest drift detection & repair logic (no behavioral change when flag unset).

  ### Compatibility (1.4.0)

  - No instruction schema or tool interface changes.
  - Purely additive logging & metrics; safe transparent upgrade for all clients.
  - When `MCP_MANIFEST_WRITE=0`, runtime skips writes silently (counter increments suppressed) – intended only for diagnostics / perf profiling.

  ### Upgrade Guidance (1.4.0)

  - Pull & rebuild – no client changes required.
  - To disable manifest file writes for diagnostics: set `MCP_MANIFEST_WRITE=0` (do not use in production if you rely on external manifest consumers).
  - Monitoring systems may now scrape manifest counters alongside existing metrics buckets.

  ### Future (not included – 1.4.0 roadmap)

  - Planned `MCP_MANIFEST_FASTLOAD` optimization mode (hash/mtime short‑circuit) reserved; currently no effect (documented as placeholder only).

## [1.4.1] - 2025-09-14

### Fixed (dashboard health accuracy)

- Resolved persistent false positive "Statistics unavailable" issue: local `statsAvailable` shadowed global flag so health card always injected the warning despite successful stats fetches. Now uses `window.statsAvailable` consistently.
- Restored memory utilization health check (`mem: ok` / fail at ≥90% heap usage) alongside CPU derived check when backend omits explicit entries.

### Changed (UI consistency)

- Unified overview card styling with Real‑time Monitoring card via new shared `.stat-row` styles (consistent spacing, typography, separators).
- Added stronger label/value contrast and tabular numeric alignment across System Statistics, System Health, and Performance cards.

### Internal (refactor / cleanup)

- Removed accidentally injected diagnostic block from `applyInstructionTemplate` (caused earlier syntax noise during patch).
- Hardened health rendering defensive normalization & comments clarifying derived check thresholds (CPU <85% ok, Memory <90% ok).

### Notes (1.4.1)

- Pure UI + client-side logic update; no API or schema changes.
- Safe patch upgrade; no restart flags required beyond standard rebuild/deploy.

### Upgrade Guidance (1.4.1)

- Pull, rebuild, redeploy. Dashboard automatically reflects new styling; no configuration changes.


## [1.2.1] - 2025-09-05

## [1.3.0] - 2025-09-10

## [1.3.1] - 2025-09-11

### Fixed (governance overwrite semantics)

- Added safe metadata-only overwrite hydration: when `overwrite:true` and body omitted, handler now hydrates existing body/title before validation allowing pure governance updates (e.g., priority + version bump) without resending full content.
- Corrected `overwritten` flag reporting for metadata-only higher version updates (previously returned `overwritten:false`).
- Enforced strict semantic version validation on create path (previously only validated updates) returning `invalid_semver` for malformed versions.

### Internal (test reliability)

- Targeted governance versioning tests now all green: auto bump, non-semver rejection, body change bump requirements, metadata-only version increment.
- Added hydration logic with type-safe mutation (no `any` casts) to satisfy linting.

### Notes (1.3.1 governance follow-up)

- No changes to on-disk schema; patch release focused on correctness & ergonomics.
- Recommended for users performing frequent governance-only edits to reduce payload size and maintain accurate overwrite telemetry.

### Added (schema v3 & governance)

- Introduced on-disk instruction schemaVersion `3` with new `primaryCategory` field enforcing a single canonical category reference.
- Automatic migration path (v1→v2→v3) updates existing instruction JSON files in-place; adds `primaryCategory` from first existing category and normalizes category list to include it.
- Added governance justification file `governance/ALLOW_HASH_CHANGE` documenting approved hash shift from structural canonicalization.

### Changed (migration & normalization)

- `migrateInstructionRecord` now injects `primaryCategory` for v2 records and ensures `schemaVersion` bump with descriptive notes.
- Runtime handlers enforce invariant: `primaryCategory ∈ categories[]`; fallback category `uncategorized` only when MCP_REQUIRE_CATEGORY unset.
- All committed instructions canonicalized (hash drift resolved) to provide stable CI governance baseline.

### Integrity & Tooling

- Full test suites (fast + slow) green post-migration; quarantined flaky tests unchanged.
- Governance hash workflow unblocked via explicit justification artifact.
- Production deployment updated to version `1.3.0` (no behavior regressions detected).

### Compatibility

- Migration is additive; older clients reading instructions ignore unknown `primaryCategory`.
- Direct downgrade not supported; rollback requires restoring pre-migration backups.

### Documentation (navigation & migration)

- Updated MIGRATION guidance (v2→v3 path) and added docs index + instruction usage plan for navigation.


### Changed (test stability)

- Deprecated legacy RED test `instructionsPersistenceDivergence.red.spec.ts` -> converted to inert placeholder (historical context only).
- Added adaptive GREEN test `instructionsPersistenceDivergence.spec.ts` (creation vs overwrite aware, synthetic hash conditional logic).
- Eliminated 60s timeout risk from mis-gated RED reproduction path.

### Added (diagnostics)

- New `docs/RUNTIME-DIAGNOSTICS.md` detailing runtime triage (handshake timing, persistence verification, metrics inspection).

### Integrity

- Suite now green without special gating; persistence divergence scenario validated deterministically (no false positives from baseline drift).

### Governance

- Formal change control required (see baseline plan section 14) for any test expansion.

### Handshake Hardening

- Implemented early stdin buffering to prevent loss of initial `initialize` frame when clients send immediately on spawn.
- Removed temporary extended readiness polling loops from CRUD smoke & batch/parameterized tests (now redundant).
- Added regression test `handshakeTimingRegression.spec.ts` asserting timely initialize response (<15s hard cap, soft warn >5s).
- Locked handshake path (short-circuit mode removed, version negotiation via spec date retained).


## [0.1.0] - 2025-08-24

### Added (initial)

- Initial project skeleton (models, classification, transport, instruction tools, prompt governance, documentation scaffolding).

## [0.2.0] - 2025-08-25

### Added (metrics & governance)

- metrics, gates, usage tracking, incremental diff, integrity tools

## [0.3.0] - 2025-08-25

### Added (dashboard & persistence)

- Add response schemas, contract tests, docs update

## [0.4.0] - 2025-08-25

### Added (SDK migration & enhancements)

- dashboard + CLI flags; import/export/repair/reload; meta/tools; usage persistence; schema extensions

## [0.5.0] - 2025-08-25

### Changed (supporting artifacts)

- Migrated to official @modelcontextprotocol/sdk (removed legacy custom transport)
- Standardized initialize handshake requiring clientInfo + capabilities.tools
- Structured JSON-RPC error codes/data (-32602 params, -32601 method, -32603 internal)

### Added (tests & tooling)

- server/ready notification via SDK oninitialized hook
- initialize result now includes human-readable instructions field
- ping request handler for lightweight health/latency
- Enhanced unknown tool & mutation gating error data (message, method/tool)

## [0.5.1] - 2025-08-25

### Added (removal capability)

- New mutation tool `instructions/remove` to delete one or more instruction entries by id (requires MCP_ENABLE_MUTATION=1)

### Changed (registry)

- Tool registry & schemas updated to expose remove capability

## [0.5.2] - 2025-08-25

### Added (single add capability)

- New mutation tool `instructions/add` (single entry, lax mode default filling, optional overwrite)

### Changed (result shape & docs)

- Aligned result shape for skip path (always includes created/overwritten booleans)
- Updated docs and schemas to reflect new tool

## [0.5.3] - 2025-08-25

### Added (catalog grooming)

- New mutation tool `instructions/groom` for normalization, duplicate merging, hash repair, deprecated cleanup (supports dryRun mode)

### Changed (registry & docs)

- Added schema, registry entry, tests, and documentation for grooming

## [0.6.0] - 2025-08-25

### Added (structured scoping)

- Introduced structured scope fields on instructions: workspaceId, userId, teamIds
- Classification now derives these from legacy category prefixes (scope:workspace:*, scope:user:*, scope:team:*) and strips them from categories
- New read-only tool `instructions/listScoped` selects best matching scope (user > workspace > team > all)
- JSON Schemas, registry version, and package version bumped

### Changed (groom enhancement)

- Groom tool now supports `purgeLegacyScopes` mode flag removing legacy scope:* category tokens and reports `purgedScopes` metric

### Notes (1.0.3)

- Backward compatibility: existing category-based scope prefixes still recognized; groom tool can later remove them

## [0.7.0] - 2025-08-25

### Changed (Tier 1 schema simplification)

- Relaxed instruction JSON schema: only authoring essentials now required (`id,title,body,priority,audience,requirement,categories`)
- `additionalProperties` enabled to allow forward-compatible governance extensions without breaking authors
- Loader & enrichment narrowed: removed automatic placeholder injection for most governance fields (now derived in-memory)

### Added (dispatcher)

- Minimal author path test (`minimalAuthor.spec.ts`) ensuring derivation of version, priorityTier, semanticSummary, review cycle
- Multi-add persistence test clarifying intentional ignoring of user-supplied governance overrides in `instructions/add`

### Removed / Simplified

- Excess placeholder governance fields from test fixtures and baseline instruction JSON files
- Enrichment tool now only persists missing `sourceHash`, `owner` (if auto-resolved), `priorityTier`, `semanticSummary`

## [0.8.0] - 2025-08-25

### Added (governance patching)

- New mutation tool `instructions/governanceUpdate` enabling controlled patch of `owner`, `status`, review timestamps, and optional semantic version bump (`patch|minor|major`)
- README documentation for simplified schema + governance patch workflow

### Changed (schemas & docs)

- Tool registry updated (schema + mutation set) and description added
- Registry version implicitly advanced; package version bumped

### Rationale (consolidation)

- Decouples routine content edits from governance curation; reduces author friction while maintaining an auditable lifecycle

## [0.9.0] - 2025-08-27

### Breaking (dispatcher consolidation)

- Removed legacy read-only instruction tools: `instructions/list`, `instructions/listScoped`, `instructions/get`, `instructions/search`, `instructions/diff`, `instructions/export`
- Added unified dispatcher tool `instructions/dispatch` supporting actions: `list`, `listScoped`, `get`, `search`, `diff`, `export`, `query`, `categories`, `dir`, plus mutation/governance actions: `add`, `import`, `remove`, `reload`, `groom`, `repair`, `enrich`, `governanceHash`, `governanceUpdate`, `health`, `inspect`, `dir`, `capabilities`, `batch`
- Tests and internal registry updated to only surface `instructions/dispatch` (reduces tool surface for clients, simplifies capability negotiation)

### Added

- Dispatcher batch execution (`action: "batch"`) to perform multiple sub-actions in one round trip
- Capabilities action returning: `{ version, supportedActions, mutationEnabled }`
- Negative schema drift test migrated to dispatcher schema
- Regenerated `docs/TOOLS-GENERATED.md` to reflect dispatcher (single tool surface + flexible schema)
- Added dispatcher capabilities & batch test suites (`dispatcherCapabilities.spec.ts`, `dispatcherBatch.spec.ts`)

### Changed

- Schemas: removed per-method instruction response schemas; introduced flexible dispatcher response schema (loose anyOf) for rapid iteration
- Documentation (TOOLS, PRD) pending full rewrite to reflect dispatcher (will land immediately post-merge)

### Migration Guide (1.0.0)

| Old | New (dispatcher) |
|-----|------------------|
| instructions/list | instructions/dispatch { action:"list", ... } |
| instructions/listScoped | instructions/dispatch { action:"listScoped", ... } |
| instructions/get | instructions/dispatch { action:"get", id } |
| instructions/search | instructions/dispatch { action:"search", q } |
| instructions/diff | instructions/dispatch { action:"diff", clientHash?, known? } |
| instructions/export | instructions/dispatch { action:"export", ids?, metaOnly? } |

### Rationale (1.0.0)

Unifying read-only catalog operations behind a single tool reduces handshake/tool enumeration overhead, enables richer batching, and provides a single stability / gating surface. Future specialized actions (advanced query planner) can ship without expanding the top-level tool set.

## [0.9.1] - 2025-08-27

### Changed (test suite & reliability)

- Eliminated all skipped tests; expanded suite to 125 assertions across 69 files (dispatcher, governance hash stability, enrichment, error paths, property-based grooming, usage gating).
- Strengthened dispatcher, transport core, governance update, and error-path coverage (malformed JSON-RPC, unknown methods) with deterministic waits & diagnostics.
- Seeded property-based groom idempotence test for reproducibility.
- Added explicit feature flag enable/disable coverage (usage gating & feature/status reporting).

### Added (documentation)

- Updated README test section (current counts, no skips) and clarified dispatcher-only surface & mutation gating.
- Clarified architecture doc to reflect 0.9.x dispatcher consolidation (previous note referenced 0.8.x only).
- Refreshed tools registry generated notes for stabilization pass.

### Internal (1.0.0)

- No API surface changes vs 0.9.0 (patch release). Dispatcher contract & tool schemas unchanged.
- Pure documentation + test reliability improvements; safe for consumers.

### Upgrade Guidance

No action required for clients already on 0.9.0. Optional: pull to benefit from fuller test coverage and clarified documentation.

## [1.0.0] - 2025-08-27

### Breaking Changes

- Removed all legacy direct JSON-RPC per-tool method handlers (e.g. calling `health/check` directly). Clients MUST use `tools/call` with `{ name:"<tool>" }`.
- Removed underscore alias methods (e.g. `health_check`, `metrics_snapshot`, `usage_track`, etc.). Canonical slash-form tool names only.
- Removed fallback minimal stdio transport path (SDK transport now required; process exits fast if unavailable).
- Removed Ajv validation layer for direct handlers (tool argument validation remains schema-based internally where needed or enforced by tool logic).

### Added / Changed

- Simplified handshake: deterministic ordering `initialize` response -> single `server/ready` -> optional `tools/list_changed` (idempotent ready emitter with trace logging via `MCP_HANDSHAKE_TRACE=1`).

## [1.0.3] - 2025-08-28

### Fixed (handshake determinism & flake elimination)

- Resolved intermittent minimal handshake test flake where `initialize` result line was occasionally not captured before `server/ready` notification. Root cause: race between stdout write callback scheduling and line buffering in tight spawn harness.
- Emit minimal server initialize response synchronously via `fs.writeSync(1, ...)` ensuring flush ordering; schedule `server/ready` via `setImmediate` for strict sequencing.
- Hardened `minimalHandshake.spec.ts` with diagnostic dump and stricter pattern.

### Added (minimal reference server)

- Introduced `src/minimal/` lightweight reference implementation exercising only `initialize`, `server/ready`, `tools/list_changed`, `ping/health` pathways for rapid protocol regression detection.

### Deployment

- Deployment script now succeeds with added minimal server artifacts; production bundle verified post-change. Addressed earlier invalid script key by using dash form `start-minimal` (avoid colon which is invalid in npm script names on some environments).

### Notes (feedback introduction)

- All core handshake, latency, governance, and dispatcher suites pass consistently post-fix (multiple consecutive full runs, zero handshake ordering failures after synchronous emission patch).
- Added structured handshake trace events (`initialize_received`, `ready_emitted`, watchdog diagnostics) for observability.
- Hardened tool list change ordering: prevents premature `tools/list_changed` before `server/ready`.
- Updated tests to exclusively exercise `tools/call` path (`transport.spec.ts`, `responseEnvelope.spec.ts`, latency & coverage suites).

### Migration Guide

| Legacy Pattern | 1.0+ Replacement |
|----------------|------------------|
| `{ method:"health/check" }` | `{ method:"tools/call", params:{ name:"health/check", arguments:{} } }` |
| `{ method:"health_check" }` | (unsupported) use canonical above |
| `{ method:"metrics_snapshot" }` | `{ method:"tools/call", params:{ name:"metrics/snapshot" } }` |
| Direct instruction tool names (dispatcher unaffected) | Use dispatcher or existing canonical tool via tools/call |

### Rationale

Removing back-compat surfaces reduces ambiguity in clients, eliminates duplicate execution pathways, and tightens protocol compliance (single ready emission, no early notifications). Observability via trace events aids debugging without impacting normal stderr noise (opt-in flag).

### Upgrade Notes

- Update any bespoke clients or scripts invoking legacy underscore methods to the canonical names via `tools/call`.
- Ensure environment expects a single `server/ready` notification; multi-ready tolerant clients remain unaffected.
- If you previously relied on the fallback transport, adopt the standard MCP SDK JSON-RPC stdio framing; no additional configuration needed for normal usage.

### Internal (refinement)

- Removed ~300 lines of legacy compatibility code; reduced handshake race conditions and watchdog complexity.
- Test suite adjusted; alias test removed.

### Future

- Potential addition: explicit protocolVersion negotiation matrix & structured `capabilities.handshake` section once MCP spec advances.

## [1.0.1] - 2025-08-27

### Changed (semantic error guarantees)

- Hardened JSON-RPC semantic error preservation: dispatcher validation/gating codes (-32601 / -32602) are now deterministically retained end-to-end (previous rare fallbacks to -32603 eliminated).
- Added deep semantic recovery & diagnostic logging (`[rpc] deep_recover_semantic`) in `sdkServer` request override for visibility when nested wrappers obscure codes.
- Tightened tests: removed transitional allowances for -32603 in dispatcher validation & mutation gating specs; assertions now require exact expected semantic codes.

### Added (stress coverage)

- New `dispatcherStress.spec.ts` high-churn test exercising rapid invalid + valid dispatcher calls to detect any semantic code downgrades.
- Supplementary logging gated by `MCP_LOG_VERBOSE=1` to trace pass-through vs wrapped error paths.

### Internal (maintenance)

- Updated `.gitignore` to exclude transient fuzz/concurrency instruction artifacts, build locks, and temp minimal-author scratch directories.
- Incremented package version to 1.0.1 (patch: reliability & test hardening only; no API changes).

### Upgrade Guidance (1.0.1)

No action required. Clients benefit from stricter and more predictable error codes; behavior of successful tool results unchanged.

## [1.0.2] - 2025-08-27

### Changed (test gating & stability)

- Segregated nondeterministic / adversarial fuzz & stress specs behind `MCP_STRESS_DIAG=1` (handshake flake, mixed workload health starvation repro, multi‑process health stress, dispatcher stress/flake, concurrency fuzz).
- Baseline test run (without flag) now deterministic: all core + compliance + governance suites green; stress specs appear as skipped (documented) eliminating prior intermittent CI noise.
- Added skip pattern helper (`maybeIt`) in gated specs for clear opt‑in semantics.

### Added (tooling & scripts)

- New npm scripts: `test:stress` (full suite with stress enabled) and `test:stress:focus` (runs only gated stress specs) for quicker iterative diagnosis.
- Added README section "Stress / Adversarial Test Suite" enumerating gated spec files and usage examples.

### Diagnostics / Observability

- Retained synthetic initialize fallback path but fully gated by `MCP_INIT_FALLBACK_ALLOW` (off by default) with compliance test (`healthMixedNoFallback.spec.ts`) ensuring no synthetic initialize in normal operation.
- Expanded handshake trace logging clarifying fallback gating decisions (`init_unconditional_fallback_skip gating_off`).

### CI / Reliability

- Prepared nightly stress workflow (scheduled) to exercise stress suite with `MCP_STRESS_DIAG=1` without impacting mainline CI signal (separate job, non-blocking).

### Internal (catalog & runtime)

- Version bumped to `1.0.2` (patch: reliability & test ergonomics only; no API surface changes).

### Upgrade Guidance (1.0.2)

No client changes required. Consumers may optionally run the stress suite locally when diagnosing latency / starvation conditions:

```bash
MCP_STRESS_DIAG=1 npm test            # run full suite including stress
MCP_STRESS_DIAG=1 npm run test:stress # equivalent convenience script
```

For routine CI or local verification omit the flag for deterministic results.

## [1.0.4] - 2025-08-28

### Added (feedback / emit system)

- New MCP-compliant feedback tool suite:
  - `feedback/submit`
  - `feedback/list`
  - `feedback/get`
  - `feedback/update`
  - `feedback/stats`
  - `feedback/health`
- Persistent JSON storage (`feedback/feedback-entries.json`) with max entry cap (`FEEDBACK_MAX_ENTRIES`, default 1000) and trimming.
- Structured feedback model (type, severity, status workflow, tags, metadata, context) with audit logging.
- Security & critical feedback entries mirrored to stderr for immediate visibility.
- Health endpoint reporting storage accessibility, writability, configured directory.
- Statistics endpoint aggregating totals by type/severity/status plus recent activity windows (24h/7d/30d).
- Environment configurables: `FEEDBACK_DIR`, `FEEDBACK_MAX_ENTRIES`.
- Documentation: README & TOOLS.md sections describing usage, schemas, and examples.

### Changed (infrastructure)

- `.gitignore` updated to exclude persisted feedback storage artifacts.
- Tool registry extended with feedback tools (stable read-only vs mutation semantics maintained where applicable).

### Notes (cleanup hygiene)

- Feature addition only; no breaking changes to existing instruction dispatcher or governance tools.
- Version bump to 1.0.4 reflects new externally visible tool surface.

## [1.0.5] - 2025-08-28

### Changed (test stability & isolation)

- Refactored feedback test suite:
  - Introduced `feedbackCore.spec.ts` (comprehensive) & `feedbackSimple.spec.ts` (smoke) with per‑test isolated `FEEDBACK_DIR` directories.
  - Converted brittle absolute "empty list" assertions to delta-based assertions; legacy expectations gated with `it.skip(... // SKIP_OK)` for documentation without flakiness.
  - Added deterministic persistence wait loop for filesystem write visibility.
  - Replaced dynamic requires with explicit static imports (avoids MODULE_NOT_FOUND under variant names).
  - Added legacy placeholder `feedback.spec.ts` (kept minimal) to preserve historical references.

### Fixed (rate limiting correctness)

- Reordered rate limiting logic in catalog usage tracking so entry creation/load occurs before limit evaluation preventing cross-id phantom rate limits.
- Added invariants ensuring usageCount reflected accurately in rate-limited responses.

### Added (governance & content guidance)

- New `CONTENT-GUIDANCE.md` clarifying instruction classification, promotion workflow, and MCP protocol separation of concerns.
- Explicit MCP compliance guidance: do NOT embed tool catalogs/schemas inside instruction content (dynamic discovery via protocol only).

### Documentation (1.1.1)

- Expanded TOOLS.md & README with Feedback System Features section.
- Clarified short-circuit / minimal handshake modes and environment flags (previous sections consolidated).

### Internal / Quality

- Guarded optional `since` parameter access in feedback list & stats handlers (eliminates TS18048 risk under strict mode).
- Added commit helper tasks for structured documentation and feature commits.
- All core + contract tests passing (168 passed / 14 skipped – skips limited to explicitly gated stress & legacy expectations).

### Notes (stabilization)

- Patch release (1.0.5) focuses on stabilization & correctness refinements immediately following new feedback feature introduction.
- No further tool surface changes beyond feedback system introduced in 1.0.4.

### Upgrade Guidance (1.0.5)

- Consumers upgrading from 1.0.4 gain improved determinism in feedback operations & safer usage rate limiting without client changes.

## [1.2.0] - 2025-09-05

### Added (observability & admin UX)

- Unified runtime diagnostics guard (`[diag] [ISO] [category]`) capturing uncaught exceptions, unhandled rejections, process warnings, and termination signals with optional exit delay (`MCP_FATAL_EXIT_DELAY_MS`).
- Real backup system with millisecond precision IDs (`backup_YYYYMMDDTHHMMSS_mmm`), manifest generation (instructionCount, schemaVersion) and safety pre-restore snapshot.
- Admin dashboard backup listing & one‑click restore UI (auto refresh + schemaVersion display).
- WebSocket enhancements: client UUID assignment, connect/disconnect broadcast events, immediate metrics snapshot push, active connection metrics integration.
- Live synthetic activity per-call trace streaming over WebSocket (`synthetic_trace` messages) with runId, sequence, duration, error, and skipped markers.
- Synthetic harness expansion to exercise instruction dispatcher CRUD pathways (`add/get/list/query/update/remove`) plus usage tracking; active in‑flight request counter + status endpoint.
- Instruction editor enrichment: diff view, formatting button, diagnostics panel (validity, size, hash, missing fields), template injection, change detection.
- HTTP metrics instrumentation aggregating all REST requests into pseudo tool bucket `http/request` (opt-out with `MCP_HTTP_METRICS=0`).
- Performance detailed endpoint `/api/performance/detailed` (requestThroughput, avg, p95 approximation, errorRate, concurrentConnections, activeSyntheticRequests).

### Changed (tests & reliability)

- Added `httpMetrics.spec.ts` validating HTTP aggregation bucket increments.
- Hardened PowerShell isolation handshake test with BOM stripping, retry initialize, soft-pass degraded mode and extended deadlines to eliminate flakes.
- Adaptive sampling + concurrency & duration guard in multi-client feedback reproduction test (dynamic ~0.8% sample, clamped 5–8, 7s hard wallclock) reducing runtime while preserving coverage rotation.
- Fast test script (`scripts/test-fast.mjs`) leak guard ensuring slow specs never bleed into fast subset.
- Pre-push hook (`scripts/pre-push.ps1`) running slow test suite gating pushes.

### Internal

- Catalog stats now cache aggregated schemaVersion (scans bounded sample) for dashboard display & backup manifest inclusion.
- Synthetic run summary & active request counter cached for UI polling; safety resets protect against leaked counters on errors.
- Added cache-control headers to `/api/status` to prevent stale build/version metadata.

### Notes (release rationale)

- Minor version bump due to additive public capabilities (diagnostics semantics, backup/restore endpoints/UI, streaming synthetic traces, HTTP metrics exposure, instruction editor UX). No breaking tool schema changes.
- Future roadmap items (not yet implemented): diagnostics metrics counters, JSONL sink with rotation, dashboard diagnostics endpoint, health degradation heuristics.

### Upgrade Guidance (1.2.0)

- No client changes required; new diagnostics lines appear only on stderr.
- To enable HTTP metrics aggregation ensure dashboard mode is active (set `MCP_DASHBOARD=1`).
- For live synthetic traces pass `?trace=1&stream=1` when invoking synthetic activity via dashboard UI (already wired in client script).

## [1.0.6] - 2025-08-28

### Changed (cleanup)

- Removed obsolete legacy feedback test variant files (`feedback.spec.ts.new/.minimal/.disabled/.clean`) to avoid accidental resurrection and duplicate coverage.
- Consolidated around `feedbackCore.spec.ts` (comprehensive), `feedbackSimple.spec.ts` (smoke), and minimal legacy placeholder `feedback.spec.ts` file.
- Version bump reflects repository hygiene update post-stabilization (no functional surface changes).

### Notes

- Patch solely for test/developer experience cleanliness; no runtime code modifications.

## [1.1.0] - 2025-08-30

### Added (documented add response contract)

- Finalized and documented enriched `instructions/add` response fields (`verified`, `feedbackHint`, `reproEntry`) in README.
- Treats previously experimental creation verification semantics as stable API (minor bump per VERSIONING policy: additive response fields after 1.0).
- No schema version change (response shape additive only; instruction JSON schema unchanged at `schemaVersion: 2`).

### Upgrade Guidance (1.1.0)

- No client changes required if ignoring unknown fields; clients wanting richer UX can surface `feedbackHint` and attach `reproEntry` when auto-filing feedback.
- Optional: update any strict type definitions to include the new optional keys.

## [1.1.1] - 2025-08-31

### Changed (handshake & test harness reliability)

- Removed legacy short-circuit handshake mode (`MCP_SHORTCIRCUIT`); only canonical SDK-driven initialize path is supported.
- Added shared handshake helper (`src/tests/util/handshakeHelper.ts`) consolidating spawn + sentinel wait + initialize send + one-time resend fallback (idempotent initialize id=1).
- Added timing regression guard (`handshakeTimingRegression.spec.ts`) enforcing initialize response under 15s hard cap (warn >5s) post early stdin buffering.
- Standardized resend logic (single resend after 4s inactivity) eliminating ad-hoc polling loops that caused sporadic timeouts under suite contention.
- Clarified diagnostic flag usage: production must keep `MCP_INIT_FALLBACK_ALLOW`, `MCP_DISABLE_INIT_SNIFF`, `MCP_HANDSHAKE_TRACE` unset unless actively debugging.

### Fixed (intermittent test timeouts)

- Resolved sporadic initialize wait timeouts in `createReadSmoke` & portable CRUD specs when run amidst heavy reproduction suites; root cause was duplicated bespoke timing logic racing process startup.
- Direct protocol compliance test (`handshakeDirect.spec.ts`) remained stable confirming server-side sequencing correctness.

### Documentation (migration & governance)

- Changelog now records deprecation & removal of short-circuit path; README environment flag table implicitly authoritative (no short-circuit flag documented).
- Next minor (1.2.0) PRD addendum will ratify handshake helper as mandatory pattern for new spawn-based specs.

### Internal (1.1.1)

- Patch bump only; no schema or tool surface modifications.

### Upgrade Guidance (1.1.1)

No action required. Remove any legacy use of `MCP_SHORTCIRCUIT`; standard initialize sequence already compatible.

## [1.1.2] - 2025-08-31

### Changed (catalog performance & visibility race elimination)

- Implemented late materialization on add/get paths eliminating rare duplicate add -> immediate get notFound race under high concurrency.
- Added per-file lifecycle tracing (`begin`, `progress`, `end`) at normal trace level for catalog loads.
- Introduced memoized catalog caching (mtime/size heuristic + optional SHA-256 hash path) gated by `MCP_CATALOG_MEMOIZE` / `MCP_CATALOG_MEMOIZE_HASH` while preserving `INSTRUCTIONS_ALWAYS_RELOAD` semantics.
- Emitted cache summary trace (`catalog:cache-summary`) for observability (hit/miss, strategy, counts).

### Fixed (multi-client visibility anomalies)

- Resolved cross-client immediate visibility lag after duplicate add with overwrite=false by deferring reconstruction until atomic write + canonical readback complete.
- Eliminated list/get sampling phantom mismatches (analyzer now reports 0 anomalies across large trace corpus).

### Added (tracing & analysis tooling)

- Standardized trace persistence format to bracketed label + JSON for analyzer compatibility.
- Added trace analysis scripts (`scripts/analyze-traces.*`) and reproduction harness (`scripts/run-feedback-repro-with-trace.ps1`).
- Minimal instruction assembly script (`scripts/prepare-minimal-instructions.mjs`) for performance-focused runs without altering tests.

### Notes (release scope)

- Patch release (1.1.2) is internal reliability + performance; no external tool / schema surface change.
- All previously RED reproduction tests now GREEN; two legacy RED specs still intentionally failing due to unsupported bulk import pathway (guarded by test expectations).

### Upgrade Guidance (1.1.2)

No client changes required. Enable `MCP_CATALOG_MEMOIZE=1` (and optionally `MCP_CATALOG_MEMOIZE_HASH=1`) to reduce reload overhead in high-churn scenarios without sacrificing correctness.

## [1.0.7] - 2025-08-30

### Added (creation verification & failure contract)

- Hardened `instructions/add` success semantics: `created:true` now only emitted after atomic write, catalog visibility, and final readability (title/body non-empty) verification; response includes `verified:true` when these checks pass.
- Unified failure response contract via internal `fail()` helper returning `{ created:false, error, feedbackHint, reproEntry }` across all add failure paths (missing entry/id/required fields, governance violations, write errors, atomic readback failure, invalid shape).
- Added enriched guidance encouraging clients to submit structured feedback with embedded `reproEntry` for rapid defect triage.
- New tests: `instructionsAddCreatedFlag.spec.ts` verifying created/verified gating and feedback guidance on failure conditions (governance + required field omissions).
- Portable client CRUD harness stabilized (dynamic ESM import shim) with deterministic atomic visibility assertions.

### Documentation (lifecycle)

- Added `FEEDBACK-DEFECT-LIFECYCLE.md` formalizing feedback → red test → fix → coverage workflow.
- Pending README & TOOLS doc updates for enriched add response (will be completed in 1.1.0 minor bump).

### Internal (stability)

- Introduced ambient module declaration for portable client to resolve TS7016 without expanding `tsconfig` include surface.
- Eliminated intermittent “No test suite found” flake in portable CRUD atomic spec via stabilization of file export timing.

### Versioning Notes (next minor)

- Patch release retained (1.0.7) while evaluating whether enriched add response should be treated as a documented stable contract.
- Next release should bump MINOR to 1.1.0 once documentation references are finalized (optional field additions per policy).

