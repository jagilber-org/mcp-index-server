# Documentation Index

This index distinguishes between **active** project documentation and **archived historical artifacts** moved under `docs/archive/`.

## Active (Authoritative) Documents

| Category | File | Purpose |
|----------|------|---------|
| Requirements | `PROJECT_PRD.md` | Canonical product & governance requirements |
| API / Tools | `TOOLS.md` | MCP tool catalog & schemas |
| Configuration | `MCP-CONFIGURATION.md` | MCP multi-environment setup patterns |
| Server Runtime | `CONFIGURATION.md` | Flags, env vars, CLI switches |
| Content Strategy | `CONTENT-GUIDANCE.md` | Instruction curation & promotion workflow |
| Prompts | `PROMPT-OPTIMIZATION.md` | Prompt handling & optimization guidance |
| Architecture | `ARCHITECTURE.md` | System & component design |
| Manifest | `MANIFEST.md` | Catalog manifest lifecycle, invariants, fastload roadmap |
| Security | `SECURITY.md` | Security controls & compliance posture |
| Dashboard | `DASHBOARD.md` | Admin UI usage & drift maintenance |
| Testing | `TESTING-STRATEGY.md` | Test tiers, quarantine & drift policies |
| Runtime Diagnostics | `RUNTIME-DIAGNOSTICS.md` | Error & signal instrumentation |
| Versioning | `VERSIONING.md` | Release semantics & governance |
| Migration | `MIGRATION.md` | Upgrade & breaking change handling |
| PowerShell MCP | `POWERSHELL-MCP-GUIDE.md` | PowerShell server integration guide |
| Agent Graph Strategy | `AGENT-GRAPH-INSTRUCTIONS.md` | Operational playbook for agents leveraging graph/export |

### Recent Governance & Runtime Updates (1.4.x)

1.4.x adds:

* Manifest subsystem central helper + counters; disable flag `MCP_MANIFEST_WRITE=0`.
* Opportunistic in-memory materialization (race-free add visibility).
* PRD 1.4.2 ratified manifest & materialization requirements (see `PROJECT_PRD.md`).
* Continued governance stability (SemVer create enforcement & overwrite hydration retained from 1.3.1).

## Archived (Historical / Temporal)

Located under `archive/<year>/`:

| Year | Files (examples) | Notes |
|------|------------------|-------|
| 2025 | `CHECKPOINT-feedback-analysis-2025-08-30.md`, `HEALTH-CHECKPOINT-2025-08-31.md`, `SESSION_LOG_20250827.md` | Point-in-time analyses & session traces |

## Policy

See `archive/README.md` for retention guidance. Archived files should not be updated; create new active docs instead or add addenda to canonical documents.
