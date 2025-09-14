# Knowledge & Instruction Constitution

Version: 0.1.0 (initial migration from spec-kit model)
Status: draft
Last-Updated: 2025-09-14

## Purpose

Establish foundational governance for instructions and knowledge artifacts in this repository, adapted from the `github/spec-kit` constitutional model while integrating existing advanced local-first workflows.

## Core Principles

1. Local-First Evolution: Knowledge matures locally (P0) before promotion.
2. Progressive Disclosure: Minimal bootstrap spec precedes richer lifecycle specs.
3. Deterministic Quality Gates: Promotion and persistence follow documented scoring & validation.
4. Separation of Concerns: Instructions describe workflows; MCP protocol handles dynamic tool discovery.
5. Traceability: Every promoted instruction/spec links to origin context and validation evidence.
6. Minimal Viable Specification First: Each new domain starts with a bootstrapper spec (category: `bootstrapper`).

## Priority Levels (P-Scale)

- P0: Workspace-local, immediate utility, not shareable yet.
- P1: Foundational shared practices enabling higher-level scaling (may have multiple sequential P1 specs: bootstrapper then lifecycle).
- P2+: Expansions, optimizations, domain specializations.

## Categories

Base categories classify intent & maturity:

- `bootstrapper`: Establishes minimal structure & required interfaces (first P1 in a track).
- `lifecycle`: Defines end-to-end managed process after bootstrap stability (second P1 here: knowledge lifecycle).
- `governance`: Cross-cutting quality, compliance, and control surfaces.
- `integration`: Protocol or external system interoperability instructions.
- `diagnostics`: Health, tracing, debugging patterns.
- `performance`: Optimization & efficiency patterns.

## Specification Artifacts

- `memory/constitution.md` (this file): Governance anchor.
- `specs/000-bootstrapper.md`: Minimal P1 establishing dual-layer (P0 local vs shared index) model.
- `specs/001-knowledge-index-lifecycle.md`: Lifecycle framework expanding bootstrap.
- `templates/spec-template.md`: Authoring template for future specs.

## Quality Gates Mapping

Links to existing enforcement:

- Feedback System Tools: `feedback/submit`, `feedback/update`, etc. ensure lifecycle issue tracking.
- Instruction Catalog Integrity: Repair & gating tests validate schema conformance.
- Promotion Scoring Matrix: (Breadth × Accuracy × Clarity × Value × Maintainability)/5 >= threshold.

## Change Control

- Minor updates: version patch with rationale note in header.
- New spec introduction: requires reference to bootstrap spec lineage.
- Deletions: must record rationale and migration path.

## Review Cadence

- Quarterly governance review or upon critical incident.
- Automated reminders may be added via future tooling.

## Open Items

- Formal schemaRef alignment for spec frontmatter (planned).
- Automation for promotion scoring (planned).

---
Initial constitution seeded; evolves under controlled amendments.
