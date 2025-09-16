# MCP Index Server Deployment & Troubleshooting Guide

> Purpose: Provide a single, opinionated, end-to-end reference for standing up, promoting, operating, and troubleshooting MCP Index Server instances across development, staging, and production while preserving governance guarantees and observability.

---
## 1. Deployment Profiles


| Profile | Goal | Characteristics | Typical Settings |
|---------|------|-----------------|------------------|
| Dev (workbench) | Rapid iteration & feature validation | Local filesystem, verbose logs, mutation enabled | `MCP_ENABLE_MUTATION=1`, `MCP_LOG_VERBOSE=1`, `MCP_DEBUG=1`, `MCP_DASHBOARD=1` |
| Shared Dev / Integration | Cross-developer validation & test harness | Stable path, persistent metrics, controlled mutation | `MCP_METRICS_FILE_STORAGE=1`, optional `MCP_BOOTSTRAP_AUTOCONFIRM=1` (tests) |
| Staging / Pre-Prod | Release candidate soak | Mirrors prod paths & policies, seeded baseline | Same as prod + extra diagnostics `MCP_LOG_DIAG=1` if needed |
| Production | Stable catalog serving & governance | Locked paths, minimal verbosity, audit logging | `MCP_ENABLE_MUTATION=1` (if governed), no verbose/diag unless incident |
| Reference / Read-Only | Immutable published snapshot | All mutation permanently disabled | `MCP_REFERENCE_MODE=1` |

---
 
## 2. Filesystem Layout (Recommended)

```text
<mcp-root>/
  mcp-index-server-prod/
    instructions/           # Production runtime catalog (JSON files)
    dist/                   # Built server artifacts
    logs/ (optional)        # Central log aggregation target (if not using default)
    metrics/ (optional)     # If using file-backed metrics ring
  mcp-index-server-stage/   # Staging mirror
  mcp-index-server-archive/ # Historical snapshots (optional)
```

Keep dev working copy separate: e.g. `C:/github/jagilber/mcp-index-server` pointing `INSTRUCTIONS_DIR` to a *dev* folder (`devinstructions/`) to avoid accidental mutation of production catalog during debugging.

---
 
## 3. Bootstrap & Auto-Seeding

On startup the server guarantees presence of two baseline governance instructions:

- `000-bootstrapper`
- `001-lifecycle-bootstrap`

They are auto-created (idempotent, non-destructive) if missing unless you set:

```bash
MCP_AUTO_SEED=0
```

Verbose seeding diagnostics:

```bash
MCP_SEED_VERBOSE=1
```
 
Structured log event: `seed_summary` with fields: `created`, `existing`, `disabled`, `hash` (deterministic canonical hash for auditing).

 
### When Copying Production Instructions to Dev

If you copy `instructions/` from production into a dev directory:

- The seeding system detects both seeds already exist and emits `seed_summary` with `created=[]`, `existing=[...]`.
- No overwrites occur.
- If you *only* copy a subset and omit a seed, the missing one will be recreated—this is safe and expected.

 
### Bootstrap Confirmation Flow Recap

1. Fresh workspace (only seeds) → mutation gated: `bootstrap_confirmation_required`.
2. Call `bootstrap/request` → get token.
3. Human approves; call `bootstrap/confirmFinalize`.
4. Confirmation artifact `bootstrap.confirmed.json` persists.
5. Any additional instruction beyond the seeds implicitly means existing workspace (confirmation optional).
6. `MCP_REFERENCE_MODE=1` short-circuits everything: catalog immutable forever.

Test harness shortcut: `MCP_BOOTSTRAP_AUTOCONFIRM=1` (never use in prod).

---
 
## 4. Environment Variable Matrix (Key Operational Controls)

| Variable | Purpose | Typical Prod | Typical Dev |
|----------|---------|--------------|-------------|
| `INSTRUCTIONS_DIR` | Catalog root | Stable prod path | `devinstructions/` |
| `MCP_ENABLE_MUTATION` | Enable write ops after gating | 1 (if governed) | 1 |
| `MCP_REFERENCE_MODE` | Force read-only | 0 | 0 or 1 (testing) |
| `MCP_AUTO_SEED` | Auto-create baseline seeds | 1 | 1 |
| `MCP_SEED_VERBOSE` | Extra stderr seed log | 0 | 1 |
| `MCP_LOG_FILE` | Enable file logging | 1 | 1 |
| `MCP_LOG_VERBOSE` | Verbose transport logs | 0 | 1 |
| `MCP_LOG_DIAG` | Diagnostic internals | 0 | 1 (selective) |
| `MCP_TRACE_FILE` | Structured tracing file | 0 | 1 (targeted) |
| `MCP_METRICS_FILE_STORAGE` | Persist metrics ring | 1 | 1 or 0 |
| `MCP_METRICS_MAX_FILES` | Metrics rotation depth | 720 | 120 (faster turnover) |
| `MCP_BOOTSTRAP_AUTOCONFIRM` | Test auto-confirm | 0 | 1 (tests only) |
| `MCP_LOG_SYNC` | Synchronous log fsync (tests) | 0 | 1 (CI deterministic) |

---
 
## 5. Deployment Workflow

 
### 5.1 Build Artifact

 
```bash
npm ci
npm run build
```
Artifacts: `dist/server/index.js` plus dashboard assets (copied by `scripts/copy-dashboard-assets.mjs`).

 
### 5.2 Promote to Target

Use provided PowerShell script:

```powershell
pwsh -File scripts/deploy-local.ps1 -Rebuild -Overwrite -TargetDir C:\mcp\mcp-index-server-prod
```
 
Flags:

- `-Rebuild` – runs `npm ci && npm run build` prior to copy
- `-Overwrite` – replaces existing target directory
- `-BundleDeps` – (if available) copies node_modules for isolated host

 
### 5.3 First Start (Prod)

 
```bash
# Example (stdio integration client config points cwd here):
node dist/server/index.js --dashboard-port=8787
```
 
Verify logs (stderr) contain:
- `[startup] Dashboard server started successfully` (if dashboard enabled)
- `seed_summary` (first start or hash check) – confirm `existing` vs `created`
- `server_started`

 
### 5.4 Validation Checklist
 
| Item | Command / Tool | Expectation |
|------|----------------|-------------|
| Seed Summary | logs / `seed_summary` | created=2 (fresh) or created=0 (existing) |
| Mutation Gate | tools/call bootstrap/status | requireConfirmation=false (existing) or true (fresh) |
| Instructions Health | tools/call instructions/health | recursionRisk=none |
| Metrics Snapshot | tools/call metrics/snapshot | tool counts increment on calls |

---
 
## 6. Copying Production Instructions to Dev (Troubleshooting Scenario)
You mentioned copying production instructions into dev to reproduce an issue. Recommended steps:
1. Decide isolation path: create `devinstructions-prod-clone/`.
2. Copy: `robocopy C:\mcp\mcp-index-server-prod\instructions C:\github\jagilber\mcp-index-server\devinstructions /E`
3. Point dev config (`.vscode/mcp.json`) `INSTRUCTIONS_DIR` to cloned folder.
4. Start server with verbose flags: `MCP_LOG_VERBOSE=1 MCP_LOG_DIAG=1`.
5. Run targeted test or reproduce workflow.
6. Compare logs vs prod baseline. Key events: `catalog-summary`, `tool_start/tool_end`, `seed_summary`, `bootstrap_status`.
7. After debugging, discard clone to avoid accidental mutation of real prod snapshot.

If you *only* copied some files and lost a seed, auto-seed reintroduces it—this is safe. To detect divergence, compare the `hash` in `seed_summary` between environments; mismatch after manual edits signals drift.

---
 
## 7. Troubleshooting Matrix

| Symptom | Likely Cause | Action |
|---------|--------------|-------|
| Mutation blocked unexpectedly | Missing confirmation or reference mode | Call `bootstrap/status`; if `requireConfirmation=true`, complete token flow. Check `MCP_REFERENCE_MODE`. |
| Seeds recreated on existing workspace | Seeds deleted manually | Accept recreation; investigate deletion; enable `MCP_SEED_VERBOSE=1` for audit timing. |
| No `seed_summary` line | Logging misconfigured or very early crash | Ensure `MCP_LOG_FILE=1`; confirm `autoSeedBootstrap()` runs before catalog usage; inspect stderr for stack traces. |
| Tool calls lack `tool_end` | Asynchronous logging flush race in tests | Use `MCP_LOG_SYNC=1` (test only) or increase polling window. |
| Drift in governance hash | Manual edits without bumping version | Run `governanceHash` tests; re-export canonical spec; version increment. |
| Dashboard won’t start | Port in use / blocked | Use `--dashboard-port=<free>` or set `MCP_DASHBOARD_PORT`; check firewall. |
| Catalog shows zero instructions | Wrong `INSTRUCTIONS_DIR` | Confirm path & permissions; check stderr `[startup] toolsRegistered... instructionsDir="..."`. |

---
 
## 8. Observability Signals
Key structured events (JSON logs):
- `logger_init` – file log path, size
- `seed_summary` – seeding outcome
- `catalog-summary` – counts (scanned / accepted / skipped) + salvage
- `tool_start` / `tool_end` / `tool_error` – lifecycle timing + correlation
- `bootstrap_status` (via tool) – current gating state

Aggregate or forward these into your logging system for RUM or audit trails. Correlate by timestamp or add a future correlation ID if centralization requires cross-instance stitching.

---
 
## 9. Hardening Recommendations
| Area | Control |
|------|---------|
| Integrity | Periodic integrity job computes canonical seed hash & compares to `seed_summary.hash`. |
| Backup | Snapshot `instructions/` + `metrics/` nightly. |
| Promotion | Git-based PR review for instruction changes; promote via controlled import tool. |
| Drift Detection | Scheduled tool invoking `catalog-summary` & diffing against last baseline snapshot. |
| Access | File ACL restrict write to service account; devs mutate via controlled workflow only. |

---
 
## 10. FAQ
**Q:** How do I fully reset a dev workspace?  
**A:** Delete the dev instructions directory contents; restart server. Seeds auto-reappear; confirmation gating re-engages (unless non-seed files added). 

**Q:** How do I simulate production read-only mode?  
**A:** Set `MCP_REFERENCE_MODE=1`; seeds load but mutation tools return block reason `reference_mode_read_only`.

**Q:** Can I disable seeding for a forensic run?  
**A:** Yes: `MCP_AUTO_SEED=0`; if seeds absent you may hit gating conditions; manually copy seeds if needed for consistent bootstrap path.

---
 
## 11. Future Enhancements (Planned / Optional)
- Seed integrity enforcement: warn if on-disk seed differs from canonical JSON (without overwriting).
- Signed catalog manifests for tamper detection.
- Distributed lock / notification for multi-node catalog mutation coordination (post baseline).

---
 
## 12. Quick Reference Commands

 
```powershell
# Build & deploy (local prod)
pwsh -File scripts\deploy-local.ps1 -Rebuild -Overwrite -TargetDir C:\mcp\mcp-index-server-prod

# Start dev with verbose logging
$env:INSTRUCTIONS_DIR='C:/github/jagilber/mcp-index-server/devinstructions'; \
$env:MCP_LOG_VERBOSE='1'; $env:MCP_DASHBOARD='1'; node dist/server/index.js --dashboard-port=8787

# Check bootstrap status (example RPC via client tooling)
# tools/call name=bootstrap/status

# Metrics snapshot
# tools/call name=metrics/snapshot
```

---
 
## 13. Change Log (Document)
- v1.0: Initial creation with auto-seeding & troubleshooting guidance (2025-09-15)

---
Happy deploying – this guide should give you everything needed to reproduce prod locally, ensure seeds are present, and safely iterate.
