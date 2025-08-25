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

### Changed

- Migrated to official @modelcontextprotocol/sdk (removed legacy custom transport)
- Standardized initialize handshake requiring clientInfo + capabilities.tools
- Structured JSON-RPC error codes/data (-32602 params, -32601 method, -32603 internal)

### Added

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
