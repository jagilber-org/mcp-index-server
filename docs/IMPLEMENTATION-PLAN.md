# IMPLEMENTATION PLAN (Multi-Phase)

## Phases
1. Repo + Models + Classification ✅ (commit 9e2c113) - model types, classification, unit tests.
2. MCP Transport + Protocol Contracts ✅ (commit 93a3329) - JSON-RPC base + health.
3. Catalog Loader + Integrity (IN PROGRESS) - loader + schema validation implemented; integrity diff pending.
4. Tools: list/get/search/diff ✅ (commit 19dd93a + subsequent) - basic handlers; diff currently returns full set (optimize later).
5. Prompt Governance ✅ (uncommitted hash TBD) - prompt/review tool & criteria + tests.
6. Usage Tracking & Optimization - success: usage counter API + hotset derivation.
7. Dashboard (read-only) - success: local web UI lists instructions & metrics.
8. Dashboard Mutations + Auth - success: controlled updates with auth token.
9. Semantic Search (optional) - success: embedding index + semantic query path.
10. Gates & Policy Evaluation - success: evaluate gates.json returning structured report.
11. Governance & Integrity Tools - success: verify_integrity & report_drifts tools.
12. Observability & Metrics - success: metrics snapshot tool + structured logs.
13. Performance & Scaling - success: 10k instruction benchmark P95 list/search <50ms.
14. Security Hardening - success: input limits, sanitization tests pass.
15. Release Automation & Migration - success: version bump script + changelog generation.

## Classification Dimensions

- AudienceScope: individual | group | all
- RequirementLevel: mandatory | critical | recommended | optional | deprecated

## Testing Strategy Snapshot

- Unit (vitest): services + utilities
- Contract: JSON schema validation of tool responses (future)
- Integration: spawn transport, send sample requests
- Property: classification normalization idempotence
- Performance: synthetic catalog benchmark
- Security: malformed payload handling

## Next Immediate TODO

1. Integrity drift detection (compute vs stored hashes) & diff minimization.
2. Incremental diff contract design doc + schema.
3. Tool response JSON Schemas + contract tests.
4. Usage tracking service & hotset tool.
5. Add TOOLS.md (done) -> link from ARCHITECTURE.
6. Update TIMELINE.md automatically via script.
7. Add issue category field to prompt review output.
