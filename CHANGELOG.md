# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

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

### Notes

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
- Performance & probe scripts migrated to dispatcher

### Migration Guide

| Old | New (dispatcher) |
|-----|------------------|
| instructions/list | instructions/dispatch { action:"list", ... } |
| instructions/listScoped | instructions/dispatch { action:"listScoped", ... } |
| instructions/get | instructions/dispatch { action:"get", id } |
| instructions/search | instructions/dispatch { action:"search", q } |
| instructions/diff | instructions/dispatch { action:"diff", clientHash?, known? } |
| instructions/export | instructions/dispatch { action:"export", ids?, metaOnly? } |

### Rationale

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

### Internal

- No API surface changes vs 0.9.0 (patch release). Dispatcher contract & tool schemas unchanged.
- Pure documentation + test reliability improvements; safe for consumers.

### Upgrade Guidance

No action required for clients already on 0.9.0. Optional: pull to benefit from fuller test coverage and clarified documentation.
