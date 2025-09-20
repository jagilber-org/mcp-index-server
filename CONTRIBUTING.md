# Contributing

Thanks for your interest in contributing.

## Development Setup

1. Node 20+
2. `npm install`
3. `npm test`
4. `npm run build`

## Branching

Use feature branches. Submit PRs to `master`.

## Commit Messages

Use conventional style where practical (feat:, fix:, docs:, chore:).

## Tests

Include unit tests for new logic. Run `npm test` and ensure coverage not reduced.

### Configuration & Environment Variables

Do NOT introduce new top-level `process.env.*` usages scattered across the codebase.

All runtime and test tunables must flow through `src/config/runtimeConfig.ts`:

1. If you need a new timing / wait value, extend `MCP_TIMING_JSON` key usage (e.g. `{"featureX.startupWait":5000}`) instead of adding `FEATUREX_STARTUP_WAIT_MS`.
2. For logging verbosity, use `MCP_LOG_LEVEL` (levels: silent,error,warn,info,debug,trace) or add a trace token to `MCP_TRACE` (comma-separated) rather than a new boolean flag.
3. For mutation gating, rely on `MCP_MUTATION` (legacy `MCP_ENABLE_MUTATION` is auto-mapped; do not reintroduce it).
4. Fast coverage paths use `MCP_TEST_MODE=coverage-fast`; legacy `FAST_COVERAGE` accepted but should not appear in new code.

If an absolutely new capability requires configuration:

- Add parsing inside `runtimeConfig.ts` (with JSDoc + deprecation mapping if replacing legacy flags)
- Update `docs/CONFIGURATION.md` and README consolidation section
- Add a one-time warning for any temporary legacy alias

PRs adding raw `process.env.X` reads outside the config module will be requested to refactor before merge.

## Security

Do not include secrets in commits. Report vulnerabilities per `SECURITY.md`.

## Code Style

Respect existing formatting. Run any lint scripts if present.

## Questions

Open a discussion or issue.
