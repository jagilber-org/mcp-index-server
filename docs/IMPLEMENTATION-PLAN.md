# IMPLEMENTATION PLAN (Multi-Phase)

## Phases
1. Repo + Models + Classification ✅ (commit 9e2c113) - model types, classification, unit tests.
2. MCP Transport + Protocol Contracts ✅ (commit 93a3329) - JSON-RPC base + health.
3. Catalog Loader + Integrity (IN PROGRESS) - loader + schema validation implemented; integrity diff pending.
4. Tools: list/get/search/diff ✅ (commit 19dd93a + subsequent) - basic handlers; diff currently returns full set (optimize later).
5. Usage Tracking & Optimization - success: usage counter API + hotset derivation.
6. Dashboard (read-only) - success: local web UI lists instructions & metrics.
7. Dashboard Mutations + Auth - success: controlled updates with auth token.
8. Semantic Search (optional) - success: embedding index + semantic query path.
9. Gates & Policy Evaluation - success: evaluate gates.json returning structured report.
10. Governance & Integrity Tools - success: verify_integrity & report_drifts tools.
11. Observability & Metrics - success: metrics snapshot tool + structured logs.
12. Performance & Scaling - success: 10k instruction benchmark P95 list/search <50ms.
13. Security Hardening - success: input limits, sanitization tests pass.
14. Release Automation & Migration - success: version bump script + changelog generation.

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
- Integrity drift detection (compute vs stored hashes) & diff minimization.
- Tool response JSON Schemas + contract tests.
- Usage tracking service & hotset tool.
- Update TIMELINE.md automatically via script.
