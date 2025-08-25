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

### Added

- Minimal author path test (`minimalAuthor.spec.ts`) ensuring derivation of version, priorityTier, semanticSummary, review cycle
- Multi-add persistence test clarifying intentional ignoring of user-supplied governance overrides in `instructions/add`

### Removed / Simplified

- Excess placeholder governance fields from test fixtures and baseline instruction JSON files
- Enrichment tool now only persists missing `sourceHash`, `owner` (if auto-resolved), `priorityTier`, `semanticSummary`

## [0.8.0] - 2025-08-25

### Added (governance patching)

- New mutation tool `instructions/governanceUpdate` enabling controlled patch of `owner`, `status`, review timestamps, and optional semantic version bump (`patch|minor|major`)
- README documentation for simplified schema + governance patch workflow

### Changed

- Tool registry updated (schema + mutation set) and description added
- Registry version implicitly advanced; package version bumped

### Rationale

- Decouples routine content edits from governance curation; reduces author friction while maintaining an auditable lifecycle
