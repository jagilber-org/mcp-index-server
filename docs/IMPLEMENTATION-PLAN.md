# IMPLEMENTATION PLAN (Multi-Phase)

## Phases
1. Repo + Models + Classification (current) - success criteria: model types, classification service, unit tests pass, plan & architecture docs.
2. MCP Transport + Protocol Contracts - success: JSON-RPC request parsing, basic 'health' tool.
3. Catalog Loader + Integrity - success: load instruction files, hash verification.
4. Tools: list/get/search/diff - success: tool handlers responding with schema-valid payloads.
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
- Add JSON-RPC parsing (Phase 2)
- Define instruction file schema (Phase 3)
- Introduce tool response schemas (Phase 4)
