# DEPRECATED - This document has been consolidated into PROJECT_PRD.md

## ⚠️ NOTICE: This document is deprecated as of December 28, 2024

This PRD has been consolidated into the comprehensive [`PROJECT_PRD.md`](./PROJECT_PRD.md) document which serves as the single authoritative product requirements document for the MCP Index Server project.

Please refer to [`PROJECT_PRD.md`](./PROJECT_PRD.md) for all current requirements, specifications, and governance standards.

---

## Original content preserved below for historical reference only

---

Provide a deterministic, inspectable, and governance-aware Instruction Index Server for AI assistant ecosystems, enabling safe evolution of prompt/instruction corpora with strong integrity, auditability, and low-latency retrieval, while remaining easily embeddable via the Model Context Protocol (MCP).

## 2. Mission Statement

Turn a directory of JSON instruction artifacts into a versioned, queryable knowledge plane exposing:

- Integrity (tamper detection)
- Governance (projection + hash diffing)
- Usage & lifecycle metrics
- Policy & prompt review feedback

with minimal operational overhead and predictable performance up to at least O(10k) entries.

## 3. Strategic Objectives (12–18 months)

| Objective | KPI | Target |
|-----------|-----|--------|
| Deterministic governance hashing | Hash drift rate | <0.1% unintended drift per release |
| Scale to 25k instructions | P95 list latency | <120ms |
| Observability maturity | Coverage of core method metrics | 100% |
| Safe evolution | Successful migrations w/ zero blocking failures | 100% |
| Search ergonomics | Filtered retrieval coverage (priority/category/provenance) | 90% primary use cases |
| Security posture | High severity vuln SLA | <7 days remediation |

## 4. Personas

| Persona | Needs | Typical Actions |
|---------|-------|----------------|
| Governance Engineer | Track policy drift | Fetch governance hash, run prompt review |
| Platform Engineer | Integrate with AI runners | Call list/diff/search for targeted subsets |
| Compliance Analyst | Review lifecycle cadences | Query nextReviewDue & reviewIntervalDays |
| Tooling Integrator | Build dashboards | metrics/snapshot, usage/track |
| Release Manager | Validate migrations | Run integrity/verify + hash stability tests |

## 5. In-Scope Features

- Instruction catalog load & classification
- Schema versioning & migration (v1→v2)
- Governance projection & hash endpoint
- Integrity verification tool
- Usage tracking & persistence (opt-in gating)
- Metrics snapshot (method invocation + features)
- Gates evaluation engine
- Prompt review tool (pattern & must-contain checks)
- Diff & incremental change detection
- Planned (0.9.x+): category & provenance search API; distinct categories enumeration
- Planned (future): archival, full-text search, optimizer/hotset selection

## 6. Out-of-Scope (Current Cycle)

- Distributed replication / clustering
- Multi-tenant isolation at process level
- Advanced semantic similarity indexing
- RBAC / auth layer (assumed upstream)

## 7. Functional Requirements (Current & Near-Term)

| ID | Requirement | Release Target |
|----|-------------|----------------|
| FR1 | Load + validate instructions directory with per-file error isolation | 0.8.x |
| FR2 | Deterministic catalog & governance hashes | 0.8.x |
| FR3 | Integrity verification tool returning issue counts | 0.8.x |
| FR4 | Usage tracking with firstSeenTs + debounced persistence | 0.8.x |
| FR5 | Metrics snapshot tool (method counters) | 0.8.x |
| FR6 | Schema migration v2 (reviewIntervalDays persistence) | 0.9.0 |
| FR7 | Idempotent migration (single rewrite) | 0.9.0 |
| FR8 | Search filtering (category/provenance/priorityTier) | 0.9.x |
| FR9 | Distinct category enumeration | 0.9.x |
| FR10 | Governance hash stability tests integrated in CI | 0.9.0 |
| FR11 | Prompt review criteria versioning & reporting | 0.8.x |
| FR12 | Gates evaluation aggregated severity | 0.8.x |

## 8. Non-Functional Requirements

| NFR | Description | Target |
|-----|-------------|--------|
| Performance | List/diff P95 latency (10k entries) | <80ms |
| Memory | Overhead per entry (excluding body text) | <2 KB |
| Startup | Cold load + migration (10k entries) | <2s |
| Determinism | Repeat governance hash (no changes) | 100% |
| Reliability | Successful graceful shutdown flush | 99.9% sessions |
| Observability | Metrics endpoint coverage | All core tools |
| Security | No critical dependencies >30 days unpatched | Continuous |

## 9. Data Model Summary

Key entity: InstructionEntry (see `models/instruction.ts`).

- v2 additions: `reviewIntervalDays`, `archivedAt?` (placeholder)
- Governance projection subset (stable) for hashing.
- Usage & attribution: `usageCount`, `createdByAgent`, `sourceWorkspace`.

### 9.1 Multi-Source Precedence (Planned)

Multi-source aggregation will treat this repository's local instruction files as PRIMARY (precedence tier 0) and any external Microsoft Index Server (MCP) instruction feed as SECONDARY (precedence tier 1+). Conflict resolution rules:

1. Identity Collision (same `id`): prefer local entry; external ignored (logged at debug level).
2. Missing Local: include external entry with provenance `sourceWorkspace = 'ms-index'` (or configured alias) and category tag `source:external`.
3. Local-Only Content: Always authored & persisted locally (never pushed upstream automatically).
4. External Override Not Allowed: External sources cannot supersede or deprecate a local entry unless a local deprecation file is added.
5. Governance Hash Scope: Governance hash continues to operate over the merged active set, but local precedence ensures deterministic choice.

Implementation Notes (future):

- Add optional configuration: `EXTERNAL_SOURCES=ms-index::<endpoint>` (deferred).
- Represent provenance using existing `sourceWorkspace` plus category tag(s): `source:local` vs `source:external`.
- Potential future field `sourcePriority` (not in v2) if multiple external feeds required.
- Caching layer to store per-source signature; invalidation triggered independently.

Security / Trust Model:

- External instructions treated as untrusted until schema + integrity validated (same loader path).
- External-specific failures must not block local catalog availability (graceful degradation).

## 10. Migration Strategy

Automatic: On load, any schemaVersion != current triggers migrateInstructionRecord → rewrite (mutation enabled). Hash integrity test ensures no governance hash drift. Idempotence validated via test suite. Rollback safe: additive only.

## 11. API Surface (Representative)

| Method | Category | Notes |
|--------|----------|-------|
| instructions/list | Read | Supports pagination (future) |
| instructions/diff | Read | Incremental change classification |
| instructions/governanceHash | Read | Stable projection hash |
| integrity/verify | Read | Body tamper detection |
| usage/track | Mutation (gated) | Increments usage; first flush immediate |
| metrics/snapshot | Read | In-memory counters snapshot |
| gates/evaluate | Read | Rule evaluation output |
| prompt/review | Read | Pattern-based governance issues |
| instructions/search (planned) | Read | Multi-filter intersection |

## 12. Architecture Overview

Refer to `ARCHITECTURE.md` for diagrams. Core pipeline: Load → Normalize → Migrate → Cache → Serve Tools → Track/Flush. Secondary indices (planned) built post-migration.

## 13. Governance & Integrity

- Multi-layer hashing: sourceHash, catalog hash, governance hash.
- Projection immutability prevents accidental metadata drift.
- Integrity tool verifies persisted sourceHash vs body.

## 14. Observability & Metrics

- metrics/snapshot: methodCounts, feature flags, optional counters.
- Logging: verbose & mutation channels via env flags.
- Future: latency histogram capture.

## 15. Security & Compliance

- Read-only default (mutations gated by `MCP_ENABLE_MUTATION`).
- Input validation via Ajv + logical classification checks.
- Potential future additions: regex sandboxing & rate limiting.

## 16. Performance Considerations

- Avoid repeated fs scans with directory signature + `.catalog-version` sentinel.
- Migration writes only when necessary.
- Planned indexing uses Set/Map for O(1) category/provenance lookups.

## 17. Release Management

- Semantic versioning (MINOR bump for schema changes).
- Pre-release checklist: tests (all), governance hash stability, integrity zero issues, docs updates, changelog entry.
- Post-release validation: run governance hash & integrity again after first restart.

## 18. Testing Strategy

| Layer | Tests |
|-------|-------|
| Unit | classification, migration, hashing, gating |
| Integration | restart persistence, hash stability, usage flush, concurrency |
| Contract | schema tool outputs, governance hash shape |
| Property (curated) | Grooming idempotence, concurrency fuzz |

## 19. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Hidden hash drift | Dedicated hash stability test + snapshot CI gate |
| Migration loops | Idempotence test & change detection guard |
| Large category fan-out | Index build metrics & optional lazy build |
| Unbounded usage growth | Debounced flush + potential future cap |
| Regex catastrophic backtracking | Curated patterns + length caps |

## 20. Roadmap (High-Level)

| Release | Items |
|---------|-------|
| 0.9.0 | Schema v2, reviewIntervalDays persistence, hash stability tests |
| 0.9.1 | instructions/search, category index, categories tool |
| 0.9.2 | Archival semantics (archivedAt set & filter) |
| 0.10.x | Optimizer/hotset, latency histograms, advanced filtering |

## 21. Metrics & Telemetry (Initial Set)

- methodInvocationCount per tool
- totalInstructionsLoaded
- governanceHash (value & length) for monitoring (not PII)
- usageSnapshotFlushCount
- migrationFilesRewritten

## 22. Deployment / Ops

- Container-friendly; Node 20 LTS.
- Health: simple readiness once initial scan complete.
- Backup: copy instructions/ + data/usage-snapshot.json; no external DB.

## 23. Tooling & Automation

- Pre-commit build verify script.
- Contract tests ensure schema/tool compatibility.
- Migration & governance hash validated in CI pipeline.

## 24. Glossary

| Term | Definition |
|------|------------|
| Governance Hash | SHA-256 of sorted governance projections |
| Projection | Reduced metadata subset used for drift detection |
| Migration | Automatic schema rewrite to newest version |
| Usage Snapshot | Persisted usage metrics state file |

## 25. Acceptance Criteria Summary

- All FR & NFR targets met for targeted release.
- Tests: 100% pass, new v2 migration suite added.
- Documentation updated (ARCHITECTURE, MIGRATION, VERSIONING, PRD).
- Governance hash unchanged post-migration on unchanged corpora.

---
End of PROJECT PRD.
