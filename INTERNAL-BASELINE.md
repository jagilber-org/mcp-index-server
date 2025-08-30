# Authoritative Baseline Recovery Execution Plan (ONLY PLAN IN FORCE)

> This document is the single source of truth for the current recovery operation. Any prior plans, options, or exploratory efforts are **revoked**. Changes require an explicit written "CHANGE REQUEST" referencing this file.

## 0. Declaration (No Deviation Charter)

No unapproved deviation, scope creep, parallel experiments, or "quick fixes" are allowed until Phase 8 (Governance & Protection) is complete. Any new request that is not an explicit amendment to THIS plan is out-of-scope and rejected.

## 1. Objective

Restore a trustworthy, minimal, reproducible, enterprise-grade baseline for the MCP Index Server by:

- Eliminating historical noise / churn.
- Verifying core atomic persistence invariants deterministically.
- Establishing a clean, documented foundation for controlled incremental re-expansion.

## 2. Non-Objectives (Explicitly Out of Scope Now)

- Broad test suite resurrection.
- Performance / enrichment / search relevance optimization.
- Debugging flaky ancillary or exploratory tests.
- Architectural refactors.
- Feature expansion (beyond minimal selective reintroductions listed here).

## 3. Success Criteria (ALL MUST PASS)

1. Fresh clone builds ( `npm ci` + `npm run build` ) with exit code 0.
2. Minimal invariant test set passes **3 consecutive cycles** with zero failures:
   - `scripts/repro-add-get.js` (run 3x per cycle)
   - `createReadSmoke.spec.ts`
   - `portableCrudAtomic.spec.ts`
   - `instructionsAddPersistence.spec.ts`
3. No unexpected file churn: `git status` clean post-run.
4. Instruction add → immediate get → list visibility succeeds every attempt (no polling/backoff).
5. No mid-run auto-redeploy / drift triggers (deployment stability).
6. One consolidated commit: `baseline-restore` (tight diff).
7. This document + CHANGELOG entry updated to reflect baseline restoration.
8. (If CI available) Protection rules / status check use only minimal invariant suite.

## 4. Hard Failure Criteria (Abort & Reassess)

- Irrecoverable `npm ci` failure after lock remediation + single reboot attempt.
- Repro script fails deterministically after clean reset.
- Minimal tests now *require* churned changes (unresolvable without reinstating noise).

## 5. Key Artifacts

- Baseline commit (hash TBD upon completion).
- `INTERNAL-BASELINE.md` (this file).
- Minimal test files (3) + `scripts/repro-add-get.js`.
- Optional: Tag `baseline-<YYYY-MM-DD>-v1`.

## 6. Minimal Invariant Suite

| Component | Purpose |
|----------|---------|
| `scripts/repro-add-get.js` | Atomic add→get→list sentinel (fast, no harness overhead) |
| `createReadSmoke.spec.ts` | Basic CRUD smoke across canonical path |
| `portableCrudAtomic.spec.ts` | Cross-environment atomicity validation |
| `instructionsAddPersistence.spec.ts` | Persistence durability + restart semantics |

## 7. Selective Reintroduction Set (Allowed After Phase 5 Passes)

- Deploy lock mechanism (single file diff) – resiliency improvement.
- `.gitignore` enhancements for generated artifacts – noise suppression.
- Repro script (if missing) – always retained.
- (Feedback system deferred: not a core invariant dependency.)

## 8. Phases (Strict Sequential Execution)

### Phase 0. Safety Snapshot

1. `git branch backup/churn-full || true`
2. `git add -A && git commit -m "churn snapshot (pre-baseline reset)" || true`
3. Archive: `Compress-Archive -Path . -DestinationPath ../mcp-index-server-churn-snapshot.zip -Force`
   - Gate: Snapshot branch + archive exist.

### Phase 1. Hard Reset

1. Record `HASH_HEAD=$(git rev-parse HEAD)`.
2. `git reset --hard HEAD`
3. `git clean -fdx`
   - Gate: `git status` clean.

### Phase 2. Fresh Clone Environment

1. `git clone <origin-url> C:\github\mcp-index-clean`
2. `cd C:\github\mcp-index-clean`
3. `git checkout <HASH_HEAD>`
   - Gate: HEAD matches recorded hash.

### Phase 3. Dependency & Build

1. `taskkill /IM node.exe /F 2>NUL || cmd /c exit 0`
2. `npm ci`
3. `npm run build`
   - Gate: Build success, `dist/server/index.js` present.
   - Retry Policy: Single reboot if EPERM persists. Then Hard Failure.

### Phase 4. Minimal Suite Isolation

1. Ensure `scripts/repro-add-get.js` present (cherry-pick if needed).
2. Move ALL other `src/tests/*.spec.ts` out except minimal three.
3. Environment: only necessary vars (`MCP_ENABLE_MUTATION=1`).
   - Gate: Only minimal test specs remain.

### Phase 5. Deterministic Validation

Commands per cycle:

```bash
node scripts/repro-add-get.js
node scripts/repro-add-get.js
node scripts/repro-add-get.js
npx vitest run src/tests/createReadSmoke.spec.ts
npx vitest run src/tests/portableCrudAtomic.spec.ts
npx vitest run src/tests/instructionsAddPersistence.spec.ts
```

Repeat cycle x3.

Gate: 0 failures across all 9 script runs + 9 test executions.

### Phase 6. Selective Reintroduction

1. Apply deploy lock diff (cherry-pick or manual patch).
2. Apply `.gitignore` enhancements (if absent).
3. Re-run one full Phase 5 cycle (single iteration).
   - Gate: Still 0 failures.

### Phase 7. Consolidated Baseline Commit

1. Add: repro script, modified tests (minimal), deploy lock file, `.gitignore`, this doc, CHANGELOG.
2. `git commit -m "baseline-restore: establish clean minimal invariant suite and deploy lock"`
3. Optional tag push.
   - Gate: Single, tight diff commit.

### Phase 8. Governance & Protection

1. CI pipeline config: run only minimal suite.
2. Enforce status checks.
3. Tag baseline.
   - Gate: Policy active; documentation updated.

### Phase 9. Controlled Expansion (Deferred – Requires Change Request)

Rules:

- <=2 new test files per expansion PR.
- Each test annotated with its invariant.
- 3-run flake check mandatory.
- Failing or flaky additions blocked.

## 9. Risk Register & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Locked esbuild.exe | Blocks build | Medium | Fresh clone + pre-kill node + single reboot fallback |
| Lost necessary hidden fix | Regression | Low-Med | Snapshot branch + archive before reset |
| Minimal tests secretly depend on churn code | Delays baseline | Low | Fast detection in Phase 5; selectively cherry-pick only truly needed bits |
| Human reintroduces noise prematurely | Signal dilution | Medium | Governance gate (Phase 8) + documented restrictions |
| Flaky invariant mask | False green | Low | Triple-cycle deterministic validation |

## 10. Verification Matrix

| Criterion | Phase | Artifact |
|----------|-------|----------|
| Clean build | 3 | Build log |
| Atomic add/get/list | 5 | Repro script output |
| Determinism (3 cycles) | 5 | Test logs |
| Minimal diff | 7 | Git diff before commit |
| Documentation present | 7 | This file + CHANGELOG |
| Governance enforced | 8 | CI config/status check |

## 11. Prohibitions During Phases 0–7

- No new feature code unrelated to deploy lock or baseline doc.
- No reintroduction of broad test suites.
- No logging verbosity escalation unless needed for a failing invariant.
- No partial commits (single baseline commit only).

## 12. Monitoring Signals

- Unexpected file creation under `instructions/` (beyond expected minimal) → investigate immed.
- Redeploy logs or stamp churn mid-tests → stop & examine deploy lock logic.
- Test runtime doubling between cycles (>100% variance) → potential race.

## 13. Completion Declaration

Plan considered COMPLETE only when Phase 8 gates pass and Success Criteria §3 are met; recorded here with timestamp & commit hash.

Completion Record (to fill upon success):

```text
Baseline Commit: <hash>
Timestamp (UTC): <datetime>
Repro Runs: 9/9 PASS
Test Cycles: 3 PASS (0 failures)
Diff Size: <insert stats>
Tag: baseline-<date>-v1 (yes/no)
```

## 14. Change Control

Any requester must submit:

```text
CHANGE REQUEST: <summary>
Justification: <why>
Phase Impacted: <phase number or post-baseline>
Rollback Plan: <steps>
```

No execution until explicitly approved.

### 14.1 Sentinel & Commit Marker Enforcement

- A SHA256 sentinel file `.baseline.sentinel` MUST match `INTERNAL-BASELINE.md` contents.
- Any modification to this file requires commit message marker: `BASELINE-CR:` (enforced by `commit-msg` hook).
- After an approved change merges: run `npm run baseline:sentinel:update` in a clean working tree and commit the updated sentinel in the same change request.
- Pre-commit runs: `guard:baseline` + sentinel verify under `BASELINE_ENFORCE=1`.
- CI MUST execute: `BASELINE_ENFORCE=1 npm run guard:baseline && npm run baseline:sentinel:verify`.
- A mismatch = hard failure; no silent drift accepted.

### 14.2 Agent Execution Directive (Non-Negotiable)

- All baseline operations (phases, guard runs, sentinel verify/update, minimal test cycles) MUST be executed through MCP protocol tool `run-powershell` (server: `powershell-mcp-server`).
- AI agent usage of raw VS Code terminals for these actions constitutes a governance breach.
- Justification: Ensures reproducibility, timeouts, working directory control, auditability, and zero interactive prompts.
- Enforcement: `mcpConfigImperativeDirective.spec.ts` + documentation cross-links + commit-msg & pre-commit policies. Future enhancement (optional): CI pipeline denies passing status if logs reveal non-MCP invocation patterns.

---

**Status:** INITIAL AUTHORING – Awaiting execution ACK.

**Do not modify outside defined process.**

## 15. Execution Log (Authoritative)

| Timestamp (UTC) | Phase | Action | Result | Hash / Notes |
|-----------------|-------|--------|--------|--------------|
| PENDING | 0 | Snapshot branch + archive | PENDING | Will record HASH_HEAD |
| 2025-08-30 09:58:15Z | 0 | Snapshot commit + archive | CREATED | 89b6938f16ef03923b4cea2f4272d589a9748bb5 snapshot-20250830-095815-89b6938f16ef03923b4cea2f4272d589a9748bb5.zip |

Logging Rules:

- Every phase step produces a table row immediately after completion (no batching).
- If a step fails, record failure row before any remediation.
- Remediation attempts get separate rows (suffix Action with `-retry#`).
- No row deletion; corrections use an added row referencing the earlier row.

Initial pending entries inserted. Will begin population only after explicit user ACK ("ACK EXECUTE").
