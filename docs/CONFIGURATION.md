# Configuration Guide

Complete configuration and deployment reference for MCP Index Server.

This guide covers:
- VS Code integration and troubleshooting
- Local production deployment setup
- Security and mutation control
- Bootstrap confirmation workflow

---
## Troubleshooting VS Code Connection

If VS Code shows "Configured but Not Connected":

1. **Build the server**: Ensure `dist/server/index.js` exists by running `npm run build`
2. **Check the path**: Use absolute path to the server executable in your `mcp.json`
3. **Restart VS Code**: MCP connections require a full VS Code restart after configuration changes
4. **Test manually**: Quick smoke (initialize then list tools):

  ```bash
  (echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"manual-test","version":"0.0.0"},"capabilities":{"tools":{}}}}; ^
   timeout /t 1 >NUL & echo {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}) | node dist/server/index.js
  ```

  (On PowerShell you can instead run two separate writes while the process is running.)

1. **Check logs**: Enable `MCP_LOG_VERBOSE=1` to see connection details in VS Code developer console

---

## Local Production Deployment (c:\mcp)

Quick script creates a trimmed runtime copy (dist + minimal package.json + seed instructions) at `C:\mcp\mcp-index-server`.
Existing runtime instructions are now ALWAYS preserved; before any overwrite a timestamped backup is created under `backups/` (unless `-NoBackup`).

Steps:

1. Build locally (if not already):

  ```powershell
  npm run build
  ```

1. Deploy (creates backup of existing instructions when present):

  ```powershell
  pwsh scripts/deploy-local.ps1 -Destination C:\mcp\mcp-index-server -Rebuild -Overwrite
  ```

1. Install production deps (inside destination):

  ```powershell
  cd C:\mcp\mcp-index-server
  npm install --production
  ```

1. Start server (PowerShell):

  ```powershell
  pwsh .\start.ps1 -VerboseLogging -EnableMutation
  ```

  Or (cmd):

  ```cmd
  start.cmd
  ```

1. Configure global VS Code `mcp.json` to point `cwd` to `C:/mcp/mcp-index-server` and `args: ["dist/server/index.js"]`.

Notes:

* The deploy script skips copying transient or fuzz / concurrent temp instruction files.
* Re-run the deploy with `-Overwrite` to refresh dist/runtime files (instructions never deleted).
* Automatic backup: `backups/instructions-YYYYMMDD-HHMMSS/` (retention default 10; configure with `-BackupRetention N` or disable via `-NoBackup`).
* Restore latest backup:

  ```powershell
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\mcp-index-server
  ```
  
* Restore specific backup (overwriting existing):

  ```powershell
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\mcp-index-server -BackupName instructions-20250828-153011 -Force
  ```
  
* Fast code-only sync (no rebuild/tests, assumes local dist is current):

  ```powershell
  pwsh scripts/sync-dist.ps1 -Destination C:\mcp\mcp-index-server -UpdatePackage
  ```
  
* Governance & usage data live inside the instruction JSON files; keeping backups provides full recoverability.

Optional: Create a scheduled task or Windows Service wrapper invoking `pwsh -File C:\mcp\mcp-index-server\start.ps1 -EnableMutation` for auto-start.

### Deployment Manifest & Post-Deploy Smoke Test (1.5.x)

Every invocation of `scripts/deploy-local.ps1` now writes `deployment-manifest.json` at the deployment root.
This manifest is an immutable audit record of what was deployed, how, and with which core artifacts.

Manifest fields (stable, additive only):

| Field | Description |
|-------|-------------|
| `name` / `version` | Runtime package identity copied from trimmed `package.json` |
| `deployedAt` | ISO 8601 UTC timestamp of manifest creation |
| `destination` | Absolute deployment path |
| `gitCommit` | Source HEAD commit (or placeholder if no `.git` present) |
| `build.rebuild` / `overwrite` / `bundleDeps` | Flags passed to deploy script |
| `build.allowStaleDistOnRebuildFailure` | Indicates fallback to existing `dist/` was permitted |
| `build.forceSeed` / `emptyIndex` | Instruction seeding strategy captured for provenance |
| `build.backupRetention` | Retention limit applied to timestamped instruction backups |
| `environment.nodeVersion` | Node runtime version at deploy time (used for drift / repro) |
| `artifacts.serverIndex.sha256` | Hash of `dist/server/index.js` (deploy-time integrity anchor) |
| `artifacts.instructionSchema.sha256` | Hash of runtime schema file (if present) |
| `instructions.runtimeCount` | Count of non-template instruction JSON files deployed |
| `instructions.mode` | Derived classification of instruction seeding (`empty-index`, `force-seed`, etc.) |

Integrity Rationale:

* Guarantees reproducibility (exact server bundle + schema hash).
* Facilitates post-deploy diff checks (compare manifests across versions).
* Decouples operational drift detection from live filesystem state.

#### Smoke Validation

Use the new script `scripts/smoke-deploy.ps1` to verify a deployment quickly before pointing clients at it:

```powershell
pwsh scripts/smoke-deploy.ps1 -Path C:\mcp\mcp-index-server -Json
```

Checks performed:

1. `dist/server/index.js` exists and its SHA256 matches the manifest.
2. `schemas/instruction.schema.json` presence + hash (soft-fail unless `-Strict`).
3. Instruction runtime count matches manifest record.
4. Derived instruction mode matches persisted `instructions.mode`.
5. Local `node -v` equals recorded `environment.nodeVersion` (drift detection).

Exit Codes:

* `0` – All required checks passed
* `1` – One or more integrity checks failed

Flags:

* `-Json` – Emit machine-readable summary (always safe for CI ingestion)
* `-Strict` – Treat missing optional artifacts (schema) as failures

Typical CI pattern after deployment:

```powershell
pwsh scripts/deploy-local.ps1 -Destination C:\mcp\mcp-index-server -Rebuild -Overwrite -BundleDeps
pwsh scripts/smoke-deploy.ps1 -Path C:\mcp\mcp-index-server -Json
```

Manifest Comparison Example (PowerShell):

```powershell
Compare-Object \
  (Get-Content C:\mcp\mcp-index-server\deployment-manifest.json | ConvertFrom-Json) \
  (Get-Content C:\mcp\mcp-index-server-prev\deployment-manifest.json | ConvertFrom-Json) -Property version, gitCommit, artifacts
```

This surfaces version / commit / hash drift succinctly without scanning full directory trees.

Recommended Next Step (future enhancement): integrate a lightweight live tool probe (`health/check`, `meta/tools`) into an extended smoke script for end-to-end process validation after starting the server. The current script intentionally avoids starting processes to remain side-effect free.


### Admin Dashboard Usage (Optional)

```bash
# For administrators only - not for MCP clients
node dist/server/index.js --dashboard --dashboard-port=3210
# Dashboard accessible at http://localhost:3210
```

### Development

1. Install dependencies: `npm ci`
2. Build: `npm run build` (TypeScript -> `dist/`)
3. Test: `npm test`
4. Run: `npm start` (auto-builds first via `prestart`)

### Build & Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | One-shot TypeScript compile to `dist/` |
| `npm start` | Runs server after implicit build (`prestart`) |
| `npm run build:watch` | Continuous incremental compilation during development |
| `npm run dev` | Runs built server with Node's `--watch` (restarts on JS changes) |
| `npm run check:dist` | CI-friendly guard: fails if `dist/` changes after a fresh build (stale committed output) |

Recommended dev workflow (two terminals):

```pwsh
# Terminal 1 - compiler
npm run build:watch

# Terminal 2 - run server (restarts on new compiled output if using an external watcher like nodemon)
npm start
```

To enforce generated artifacts consistency in CI, add `npm run check:dist` before packaging or releasing.

#### Add / Remove Instructions (Mutation Examples)

```bash
env MCP_ENABLE_MUTATION=1 node dist/server/index.js # ensure mutation enabled
# Remove via MCP tools/call:
# method: instructions/remove
# params: { "ids": ["obsolete-id-1", "deprecated-foo"] }

# Add (single entry) via MCP tools/call:
# method: instructions/add
# params: { "entry": { "id": "new-id", "body": "Instruction text" }, "lax": true }
```

#### Add Response Contract (1.0.7+)

`instructions/add` now enforces atomic visibility + readability before signaling success.

Success response (subset):

```jsonc
{
  "id": "example-id",
  "created": true,            // Only true if record was not pre-existing AND is now durably readable
  "overwritten": false,       // True only when overwrite path explicitly taken
  "skipped": false,           // True when duplicate without overwrite
  "hash": "<catalog-hash>",
  "verified": true            // Additional guard: read-back + shape & non-empty title/body validated
}
```

Unified failure response:

```jsonc
{
  "created": false,
  "error": "mandatory/critical require owner",   // Stable machine-parsable reason
  "feedbackHint": "Submit feedback/submit with reproEntry to report add failure",
  "reproEntry": { "id": "bad-id", "title": "...", "body": "..." }
}
```

Failure reasons (non-exhaustive):

* `missing entry`
* `missing id`
* `missing required fields`
* `P1 requires category & owner`
* `mandatory/critical require owner`
* `write-failed`
* `atomic_readback_failed`
* `readback_invalid_shape`

Client guidance:

1. If `created:false`, inspect `error`.
2. Present human help text (map error → explanation) or prompt user to review governance requirements.
3. Offer one-click escalation: call `feedback/submit` including `reproEntry` + the server-reported `error` string.
4. Retry only after adjusting entry to satisfy governance or required field gaps.

Common troubleshooting:

* **"missing entry" error**: Ensure parameters are `{ "entry": { ... instruction ... } }`, not the instruction object directly
* **Backup restoration**: Extract individual instruction objects from backup files before calling add
* **Bulk import**: Use `instructions/import` for multiple entries, not repeated `instructions/add` calls

##### Schema-Aided Failure Guidance (1.1.0+)

For structural / shape errors (`missing entry`, `missing id`, `missing required fields`) the server now embeds the authoritative input schema directly in the failure response so clients can self-correct without an extra discovery round trip.

Example failure payload:

```jsonc
{
  "created": false,
  "error": "missing entry",
  "feedbackHint": "Submit feedback/submit with reproEntry to report add failure",
  "reproEntry": { "id": "bad-id", "body": "..." },
  "schemaRef": "instructions/add#input",          // Stable logical reference
  "inputSchema": {                                 // JSON Schema excerpt (may evolve additively)
    "type": "object",
    "required": ["entry"],
    "properties": {
      "entry": {
        "type": "object",
        "required": ["id", "body"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "body": { "type": "string", "minLength": 1 }
        }
      },
      "overwrite": { "type": "boolean" },
      "lax": { "type": "boolean" }
    }
  }
}


  ## 🖼️ UI Drift Detection & Snapshot Baseline

  Automated Playwright snapshot tests guard critical dashboard regions (system health card, instruction list + semantic summaries). The workflow `UI Drift Detection` runs on every push / PR and nightly to surface unintended structural or visual regressions.

  Maintenance:

  1. Intentional UI change -> run locally:

    ```bash
    npm run build
    npm run pw:baseline   # updates baseline snapshots
    git add tests/playwright/baseline.spec.ts-snapshots
    git commit -m "test: refresh playwright baseline after <reason>"
    ```
  2. CI failure triage:
    * Download `playwright-drift-artifacts` from the run
    * Open `playwright-report/index.html` for visual diffs
    * If change is expected, follow step (1); otherwise fix regression and re-run.

  Environment overrides:
  * `DASHBOARD_PORT` – choose port for local run-playwright server (default 8787)
  * `PLAYWRIGHT_UPDATE_SNAPSHOTS` / `--update` flag handled automatically by `pw:baseline` script

  Scope discipline keeps snapshots low-noise—avoid broad full-page screenshots unless necessary.

  ## 🐢 Slow Test Quarantine Strategy

  Some high-value regression tests are currently unstable (multi-client coordination & governance hash timing). They are quarantined from the default `test:slow` run to restore push velocity while stabilization work proceeds.

  Quarantined list lives in `scripts/test-slow.mjs` under `unstable`. Run them explicitly with:

  ```bash
  INCLUDE_UNSTABLE_SLOW=1 npm run test:slow
  ```

  Once stabilized, remove from `unstable` to reincorporate into regular slow gate.

### Slow Test Environment Flags

| Variable | Purpose | Typical Usage |
|----------|---------|---------------|
| `ALLOW_FAILING_SLOW=1` | Temporarily bypass failing slow suite in pre-push or CI gating while keeping visibility | Set locally to unblock while investigating failures |
| `INCLUDE_UNSTABLE_SLOW=1` | Force inclusion of quarantined unstable specs listed in `scripts/test-slow.mjs` | Periodic stabilization runs or targeted repro |

Governance: avoid committing code that permanently relies on these flags; they are short-term velocity aids. Document root cause and planned fix when using in PR descriptions.

Client remediation strategy:

1. If `schemaRef` present, prefer using `inputSchema` immediately for validation / UI hints.
2. If you had sent a flat object (e.g. `{ "id":"x", "body":"y" }`), wrap it: `{ "entry": { "id":"x", "body":"y" } }`.
3. Cache the schema per session (invalidate on `tools/list` change or version bump) rather than hard-coding shapes.
4. Continue to call `tools/list` for canonical schemas; the inline schema is a convenience, not a replacement for standard discovery.

Notes:

* Inline schema only appears for early shape gaps; governance / semantic failures (e.g. `mandatory/critical require owner`) do not echo the full schema.
* Fields may gain additive properties; treat unknown properties as forward-compatible.
* `schemaRef` is stable; you can key a local schema cache with it.

Backward compatibility: The additional fields (`verified`, `feedbackHint`, `reproEntry`) are additive; existing clients ignoring unknown keys continue working.

Process lifecycle: See `docs/FEEDBACK-DEFECT-LIFECYCLE.md` for the end-to-end feedback → red test → fix → verification workflow governing changes like this response contract hardening.

---

## Security & Mutation Control

* **MCP_ENABLE_MUTATION=1**: Enables write operations (import, repair, reload, flush)
* **MCP_LOG_VERBOSE=1**: Detailed logging for debugging
* **Input validation**: AJV-based schema validation with fail-open fallback

### Ownership Auto-Assignment

Provide an `owners.json` at repo root to auto-assign owners during add/import/bootstrap. Example:

```json
{
  "ownership": [
    { "pattern": "^auth_", "owner": "security-team" },
    { "pattern": "^db_", "owner": "data-team" },
    { "pattern": ".*", "owner": "unowned" }
  ]
}
```

First matching regex wins; fallback keeps `unowned`.

### Bootstrap Guard CI

Workflow `.github/workflows/instruction-bootstrap-guard.yml` runs catalog enrichment (`node scripts/bootstrap-catalog.mjs`) and fails if any normalized governance fields or canonical snapshot changes were not committed, preventing drift between PR content and canonical state.

### Tool Name Compatibility (1.0.0 Simplification)

All legacy underscore alias method names were removed in 1.0.0. Only canonical slash-form tool names are supported and must be invoked via `tools/call`.

Migration examples:

| Legacy (pre-1.0) direct call | 1.0+ Required Form |
|------------------------------|--------------------|
| `{ "method":"health/check" }` | `{ "method":"tools/call", "params": { "name":"health/check", "arguments":{} } }` |
| `{ "method":"health_check" }` | (unsupported) use canonical above |
| `{ "method":"metrics_snapshot" }` | `{ "method":"tools/call", "params": { "name":"metrics/snapshot" } }` |
| `{ "method":"usage_track" }` | `{ "method":"tools/call", "params": { "name":"usage/track", "arguments": { "id":"sample" } } }` |

Rationale: a single execution pathway (tools/call) eliminates duplicate validation, reduces races, and clarifies capability negotiation.

### Governance Validation Script

`node scripts/validate-governance.mjs` ensures all instruction JSON files include required governance + semantic fields. Added to bootstrap guard workflow.

* **Gated mutations**: Write operations require explicit environment flag
* **Process isolation**: MCP clients communicate via stdio only (no network access)

### Environment Flags

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `MCP_LOG_VERBOSE` | off | runtime | Enables detailed diagnostic logging (handshake, tool dispatch timings). |
| `MCP_ENABLE_MUTATION` | off | runtime | Allows mutating tools (add/import/remove/enrich/governanceUpdate/repair/reload/flush). Leave off in read-only production. |
| `MCP_DASHBOARD` | off | runtime | Enable admin dashboard (0=disable, 1=enable). Can be overridden by `--dashboard` or `--no-dashboard` CLI args. |
| `MCP_DASHBOARD_PORT` | 8787 | runtime | Dashboard HTTP port. Can be overridden by `--dashboard-port` CLI arg. |
| `MCP_DASHBOARD_HOST` | 127.0.0.1 | runtime | Dashboard bind address. Can be overridden by `--dashboard-host` CLI arg. |
| `MCP_DASHBOARD_TRIES` | 10 | runtime | Maximum port retry attempts when dashboard port is busy. Can be overridden by `--dashboard-tries` CLI arg. |
| `MCP_IDLE_KEEPALIVE_MS` | 30000 | runtime | Keepalive echo interval for idle transports (milliseconds). |
| `MCP_INIT_FALLBACK_ALLOW` | off | runtime (diagnostic) | Permits synthetic initialize fallback path used only for investigating lost/blocked initialize sequences. Keep off for protocol compliance; tests assert no synthetic markers when off. |
| `MCP_STRESS_DIAG` | off | test harness | When set to `1`, activates heavy fuzz / fragmentation / multi-process saturation tests (handshake fragmentation, long reproduction loops, escalated health contention). Left off for normal CI or production validation to ensure deterministic green suite. |
| `MCP_HANDSHAKE_TRACE` | off | runtime (diagnostic) | Extra trace around initialize & server/ready sequencing. |
| `MCP_HEALTH_MIXED_DIAG` | off | runtime (diagnostic) | Adds additional mixed workload scheduling diagnostics during health/check stress exploration. |
| `MCP_DISABLE_INIT_SNIFF` | off | runtime (diagnostic) | Disables stdin pre-read initialize sniffing logic (forces pure SDK handling). Useful to compare behavior with and without early fragmentation mitigation. |
| `MCP_MANIFEST_WRITE` | on (unset) | runtime | Set to `0` to disable writing the catalog manifest (diagnostic / read-only). |
| `MCP_MANIFEST_FASTLOAD` | (reserved) | runtime (future) | Placeholder for upcoming fast load optimization (currently no effect). |

Operational guidance:

* Keep all diagnostic flags OFF for production unless actively debugging an issue.
* Dashboard environment variables are overridden by command line arguments.
* For security, dashboard should only be enabled on localhost (127.0.0.1) for local administration.
* Enable `MCP_STRESS_DIAG=1` locally or in a dedicated CI job (e.g., nightly) to exercise adversarial workloads without destabilizing standard PR validations.
* Never enable `MCP_INIT_FALLBACK_ALLOW` in production; it is purely for reproducing initialize starvation scenarios and is guarded by compliance tests.

### Stress / Adversarial Test Suite

The following spec files (and selective cases inside some files) are gated behind `MCP_STRESS_DIAG=1` to keep the default test run deterministic and fast:

* `handshakeFlakeRepro.spec.ts`
* `healthMixedReproLoop.spec.ts`
* `healthHangExploration.spec.ts` (mixed workload + escalated scenarios only)
* `healthMultiProcessStress.spec.ts`
* `dispatcherStress.spec.ts`
* `dispatcherFlakeStress.spec.ts`
* `concurrencyFuzz.spec.ts`

Run only the core deterministic suite (default):

```pwsh
npm test
```

Run all tests including stress (local or nightly CI):

```pwsh
npm run test:stress
```

Focus just on the gated stress specs:

```pwsh
npm run test:stress:focus
```

Minimal diagnostic reproduction (legacy specific pair):

```pwsh
npm run test:diag
```

Rationale: Segregating heavy concurrency / fragmentation tests avoids intermittent initialize starvation or off-by-one health count flakes from masking real regressions in routine PR validation while retaining full reproduction power on-demand.

### Manifest & Opportunistic Materialization (1.4.x)

The server persists a lightweight catalog manifest (`snapshots/catalog-manifest.json`) after catalog‑mutating operations, maintained via a centralized helper (`attemptManifestUpdate()`). Opportunistic in-memory materialization ensures an immediately added instruction is visible without a forced reload, eliminating prior add→get race windows. A formal JSON Schema (`schemas/manifest.schema.json`) documents the manifest snapshot independently of the instruction schema (`schemas/instruction.schema.json`). See **[MANIFEST.md](./docs/MANIFEST.md)** for full lifecycle, invariants, drift categories, and fastload roadmap.

Counters (scrape via existing metrics interface):

* `manifest:write` – successful manifest persisted
* `manifest:writeFailed` – write attempt threw
* `manifest:hookError` – upstream hook invocation failed

Log Line (INFO):

```text
[manifest] wrote catalog-manifest.json count=<entries> ms=<latency>
```

Environment Flags:

* `MCP_MANIFEST_WRITE=0` – skip all writes (counters suppressed) but continue normal instruction functionality. Use for diagnostics or perf profiling only.
* `MCP_MANIFEST_FASTLOAD=1` – (preview) trust an up‑to‑date manifest on startup to short‑circuit full body re‑hash when computing drift. Falls back automatically to the normal path if the manifest is missing / invalid / drift > 0.

Design Rationale:

* Central helper `attemptManifestUpdate()` now performs an immediate synchronous manifest write (Phase F simplification). Previous debounce logic was removed to guarantee determinism and eliminate timing races. (A future high‑churn mode could reintroduce batching behind an env flag if needed.)
* Separation of concerns: instruction files validated by `instruction.schema.json` (schemaVersion `3`), manifest snapshot validated by its own schema (`manifest.schema.json`). No need to bump instruction `schemaVersion` when altering internal manifest representation.
* Additive only – no change in existing mutation semantics or instruction schema.

### Handshake Reliability (1.1.1)

As of 1.1.1 the legacy short-circuit handshake flag (`MCP_SHORTCIRCUIT`) was removed. All tests and clients MUST use the canonical MCP SDK initialize sequence:

1. Client spawns server process.
2. Server buffers early stdin until SDK ready (guards against dropped initialize in fast clients).
3. Client sends a single `initialize` (id=1). Helper may resend once if no frame observed (idempotent per spec).
4. Server responds with initialize result, then emits exactly one `server/ready`, optionally followed by `tools/list_changed`.

Test harness specs requiring direct process spawn MUST use the shared helper `performHandshake()` in `src/tests/util/handshakeHelper.ts` rather than bespoke timing loops. This ensures consistent startup behavior and eliminates intermittent initialize timeouts under parallel suite load.

Diagnostic flags affecting handshake (`MCP_INIT_FALLBACK_ALLOW`, `MCP_DISABLE_INIT_SNIFF`, `MCP_HANDSHAKE_TRACE`) are for investigation only and MUST remain unset in production deployments.
