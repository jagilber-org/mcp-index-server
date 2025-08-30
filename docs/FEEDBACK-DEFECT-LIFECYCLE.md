# Feedback → Defect → Red/Green → Fix → Coverage Lifecycle

Date: 2025-08-30
Current package version: 1.0.7
Current instruction schemaVersion: 2 (no change in this cycle)

## 1. Intake (Feedback Submission)

- Source: MCP client invokes `feedback/submit` with a structured payload (type, severity, description, context, optional tags).
- Server persists entry (JSON store) and returns an ID.
- Trigger: Presence of actionable reproduction clues (instruction IDs, operation sequence, observed vs expected behavior).

## 2. Triage & Classification

- AI / agent retrieves entry via `feedback/get` (or filters with `feedback/list`).
- Classify: (a) Alleged persistence failure, (b) Search mismatch, (c) Governance enforcement, etc.
- Determine initial severity & scope (does it threaten durability guarantees? only discoverability? security?).
- Decide required artifact set: analysis report + red tests.

## 3. Analysis Report Creation

- File produced (example: `docs/FEEDBACK-ANALYSIS-bulk-import-failures.md`).
- Contents: Summary, contradicted vs reproduced claims, hypothesis, next steps.
- Links observed instruction IDs and raw attempted payloads where available.

## 4. Red Test Authoring (Reproduction Phase)

- Create focused Vitest spec (e.g. `src/tests/feedbackReproduction.spec.ts`).
- Encode each alleged symptom as a RED test that should initially fail if defect is real OR pass if allegation is contradicted.
- Use original instruction blobs (embedded or imported) to minimize drift; name constants after feedback ID or reported instruction ID.
- Categories inside spec:
  - Persistence Validation (RED) – reported broken paths.
  - GREEN Baselines – expected healthy behavior (acts as control group).
  - Integration / Workflow – end‑to‑end backup/restore or restart durability.

## 5. Execute & Record Outcomes

- Run `npm test` (or focused run). Capture: which reports reproduce vs contradict.
- Update analysis doc with PASS/FAIL matrix (contradicted vs confirmed issues).

## 6. Root Cause Isolation

- For reproduced failures: inspect handler / service layers (e.g. instructions add pipeline, search indexing logic, governance checks).
- For contradicted failures: verify no silent flakiness (repeat runs) and annotate as “not reproduced”.

## 7. Fix Implementation

- Apply minimal, well-scoped code changes (atomic visibility checks, governance rule correction, search normalization, etc.).
- Introduce unified failure contract if missing (this cycle: `{ created:false, error, feedbackHint, reproEntry }`).
- Harden success semantics (this cycle: `created:true` only after read-back + shape validation; `verified:true` gating).

## 8. Green Test Evolution

- Re-run RED tests; they turn GREEN once fix is in place.
- Add new GREEN tests to lock in invariants (e.g. restart durability, hash stability).
- Add explicit failure-path tests for new contract fields (created/verified/error/feedbackHint/reproEntry).

## 9. Coverage Completion

- Identify untested edge paths (atomic read-back failure, invalid shape, governance edge cases).
- Add supplementary specs (e.g. `instructionsAddCreatedFlag.spec.ts`).
- Ensure no “false positive” tests (remove expectations depending on deprecated behavior like search-by-id if not supported).

## 10. Versioning Decision

- Change set in this cycle: Added optional response fields (`feedbackHint`, `reproEntry`) & refined success semantics (still backward-compatible for clients tolerant of extra fields).
- Per `docs/VERSIONING.md` policy: Adding optional response fields after 1.0 warrants a MINOR bump (feature addition) if surfaced as stable contract.
- Current state: package.json at 1.0.7 (patch growth). If we treat the enriched add response as a documented, stable contract, next release should bump to 1.1.0.
- Instruction on-disk schema (`schemas/instruction.schema.json`) unchanged (schemaVersion stays `2`): no migration; therefore no schema version bump.

### When to Bump Instruction `schemaVersion`

| Change Type | Action |
|-------------|-------|
| Add optional metadata field (ignored by old readers) | No bump (document) |
| Change required field set / constraints | Increment schemaVersion + provide migration path |
| Rename / remove field | Increment schemaVersion (breaking) |
| Add derived read-only field (non-required) | No bump |

## 11. Changelog & Tagging

- Prepare CHANGELOG entry under next version (recommend: 1.1.0):
  - Added: Unified add failure contract (feedbackHint, reproEntry), creation verification semantics.
  - Fixed: Misinterpretation of search reliability (documented clarification) or actual code fix if applied.
- Run: `pwsh scripts/bump-version.ps1 minor` (after tree clean & tests green) → commit + tag.

## 12. Post-Fix Feedback Loop

- Optionally auto-comment / respond to original feedback with resolution summary & new version number.
- Encourage submitter to retest; if still failing, new feedback entry referencing version.

## 13. Governance & Quality Gates

- Confirm: typecheck, lint, tests (including skip guard), declaration guard all pass (`npm run build:verify`).
- Deployment dry-run (local prod script) before tagging.

## 14. Documentation Update

- README: Add note describing new add response contract (fields + semantics) and guidance to use `feedback/submit` with supplied `reproEntry` on failure.
- Tool docs: Update any examples referencing add result shape.

## 15. Archival Artifacts

- Keep analysis checkpoint file (immutable historical context).
- Tests referencing feedback ID act as living regression sentinel.

---

## Quick Reference Checklist (Repeatable Template)

1. Capture feedback ID and payload.
2. Draft analysis doc (claims vs evidence).
3. Author RED tests reproducing each claim.
4. Add GREEN baseline tests (control).
5. Run & classify (contradicted / reproduced).
6. Fix root cause (minimally, with invariants).
7. Enrich contracts (optional, backward-compatible) as needed.
8. Add / extend tests (failure & success paths).
9. Decide version bump (patch vs minor) per policy.
10. Update CHANGELOG + bump + tag.
11. Update docs (README, tool contracts).
12. Notify originator / close feedback.
13. Archive analysis + keep tests.

---
## Current Cycle Outcome Summary

| Aspect | Result |
|--------|--------|
| Feedback processed | Yes (multiple entries) |
| Analysis doc | Generated (`FEEDBACK-ANALYSIS-*.md`) |
| RED tests added | Yes (`feedbackReproduction.spec.ts`) |
| GREEN baselines | Yes (persistence & backup/restore) |
| Fixes applied | Creation verification + failure contract; search behavior clarified / stabilized |
| Additional coverage | `instructionsAddCreatedFlag.spec.ts` + portable CRUD suites |
| Package version bumped | To 1.0.7 (patch so far) |
| Recommended next bump | 1.1.0 (due to new optional response fields) |
| Schema version change | None (remains 2) |
| Docs pending | Need add-response contract section in README & TOOLS docs |

---
## Action Items (Open)

| Item | Priority |
|------|----------|
| Bump to 1.1.0 & update CHANGELOG for add contract enrichment | High |

| Document add response (created, verified, feedbackHint, reproEntry) in README / TOOLS | High |
| Fault-injection tests for atomic read-back failure paths | Medium |
| Annotate governance rationale for skipped tests (if any remain) | Medium |
| Auto-feedback loop (close original with resolution note) | Low |

---
Prepared to institutionalize feedback-driven hardening. Adopt this file as the canonical playbook for future cycles.
