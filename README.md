# MCP Instruction Index Server

Enterprise-grade local Model Context Protocol server providing a governed, classified, auditable instruction catalog with analytics and a management dashboard.

## Status
Phase 1 skeleton (models + classification + tests) initialized. Next: Transport & JSON-RPC.

## Key Features (Planned)
- Deterministic catalog loading with hashing & integrity verification.
- Rich classification: audience (individual|group|all), requirement (mandatory|critical|recommended|optional|deprecated), categories, risk scoring.
- Tools: list/get/search/diff, usage tracking, integrity & drift reports, gate evaluation, metrics.
- Dashboard: read-only browse → controlled mutations.
- Semantic search (optional embeddings & vector cache).
- Governance: schema version & hash lock, drift detection, changelog automation.
- Performance target: P95 list/search <50ms @10k instructions.

## Quick Start
Install dependencies then build & test.

Hooks: on first install a pre-commit hook runs typecheck, lint, tests, and secret scan. Manual security scan: `npm run scan:security`.

## Roadmap
See `docs/IMPLEMENTATION-PLAN.md` and `docs/ARCHITECTURE.md`.
