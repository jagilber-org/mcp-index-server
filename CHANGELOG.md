# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

### Added (dispatcher capabilities & batch)

- Authoritative baseline recovery plan (`INTERNAL-BASELINE.md`) with execution log.
- Baseline guard script `scripts/guard-baseline.mjs` and npm script `guard:baseline`.
- README Baseline Restoration section and enforced minimal invariant suite policy.

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

### Internal

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

### Documentation

- Changelog now records deprecation & removal of short-circuit path; README environment flag table implicitly authoritative (no short-circuit flag documented).
- Next minor (1.2.0) PRD addendum will ratify handshake helper as mandatory pattern for new spawn-based specs.

### Internal (1.1.1)

- Patch bump only; no schema or tool surface modifications.

### Upgrade Guidance (1.1.1)

No action required. Remove any legacy use of `MCP_SHORTCIRCUIT`; standard initialize sequence already compatible.

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

