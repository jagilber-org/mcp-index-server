# MCP Index Server

![UI Drift Detection](https://github.com/jagilber/mcp-index-server/actions/workflows/ui-drift.yml/badge.svg)

**[📋 Product Requirements (PROJECT_PRD.md)](./docs/PROJECT_PRD.md)** – Authoritative binding requirements and governance

* **[🔧 API Reference (TOOLS.md)](./docs/TOOLS.md)** - Complete MCP protocol-compliant tool documentation  
* **[⚙️ Configuration Guide (MCP-CONFIGURATION.md)](./docs/MCP-CONFIGURATION.md)** - Comprehensive MCP setup patterns for all environments
* **[🔧 Server Configuration (CONFIGURATION.md)](./docs/CONFIGURATION.md)** - Environment variables and CLI options reference
* **[�️ Admin Dashboard Guide (DASHBOARD.md)](./docs/DASHBOARD.md)** - UI features, screenshots, drift monitoring & maintenance
* **[�📊 Dashboard Development Plan (DASHBOARD-DEVELOPMENT-PLAN.md)](./docs/DASHBOARD-DEVELOPMENT-PLAN.md)** - Multi-phase dashboard enhancement roadmap
* **[📝 Content Guidance (CONTENT-GUIDANCE.md)](./docs/CONTENT-GUIDANCE.md)** - What to include in local vs. central instruction servers
* **[🧠 Prompt Optimization (PROMPT-OPTIMIZATION.md)](./docs/PROMPT-OPTIMIZATION.md)** - AI prompt handling and optimization guide
* **[🔍 Portable Test Client (PORTABLE-MCP-TEST-CLIENT.md)](./docs/PORTABLE-MCP-TEST-CLIENT.md)** - Critical testing tool for MCP troubleshooting
* **[🏗️ Architecture (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)** - System design and component overview
* **[🔒 Security (SECURITY.md)](./SECURITY.md)** - Security policies and compliance

Enterprise-grade local Model Context Protocol server providing a governed, classified, auditable instruction catalog with analytics and optional admin dashboard.

## 📚 **Complete Documentation Suite**

This project provides comprehensive enterprise-grade documentation:

* **[📋 Product Requirements (PROJECT_PRD.md)](./docs/PROJECT_PRD.md)** – Authoritative binding requirements and governance
* **[🔧 API Reference (TOOLS.md)](./docs/TOOLS.md)** – Complete MCP protocol-compliant tool documentation  
* **[⚙️ Configuration Guide (MCP-CONFIGURATION.md)](./docs/MCP-CONFIGURATION.md)** – Comprehensive MCP setup patterns for all environments
* **[🔧 Server Configuration (CONFIGURATION.md)](./docs/CONFIGURATION.md)** – Environment variables and CLI options reference
* **[📝 Content Guidance (CONTENT-GUIDANCE.md)](./docs/CONTENT-GUIDANCE.md)** – What to include in local vs. central instruction servers
* **[🧠 Prompt Optimization (PROMPT-OPTIMIZATION.md)](./docs/PROMPT-OPTIMIZATION.md)** – AI prompt handling and optimization guide
* **[🔍 Portable Test Client (PORTABLE-MCP-TEST-CLIENT.md)](./docs/PORTABLE-MCP-TEST-CLIENT.md)** – Critical testing tool for MCP troubleshooting
* **[🏗️ Architecture (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)** – System design and component overview
* **[🔒 Security (SECURITY.md)](./SECURITY.md)** – Security policies and compliance
* **[📈 Instruction Usage Plan (INSTRUCTION-USAGE-PLAN.md)](./docs/INSTRUCTION-USAGE-PLAN.md)** – Active instrumentation & grooming enablement plan
* **[📚 Documentation Index (DOCS-INDEX.md)](./docs/DOCS-INDEX.md)** – Active vs archived documentation map
* **[🛡️ Runtime Diagnostics (RUNTIME-DIAGNOSTICS.md)](./docs/RUNTIME-DIAGNOSTICS.md)** – Global error, rejection, warning & signal handling

### Recently Formalized (Pending PRD 1.2.0)

* **Feedback System** – 6 MCP tools (submit/list/get/update/stats/health) with audit & security logging
* **Portable CRUD & Governance Baseline** – Minimal always-green suite (CRUD + 6 governance scenarios) guarding regression and hash determinism

### 🔐 Baseline Restoration & Guardrails

This repository operates under an authoritative baseline recovery plan defined in `INTERNAL-BASELINE.md`.

Key guarantees:

1. Minimal invariant suite only (atomic CRUD + persistence) during restoration.
2. No additional tests accepted without a formal CHANGE REQUEST (see section 14 of baseline doc).
3. Automated guard: `npm run guard:baseline` enforces presence of the baseline file and restricts unauthorized test expansion when `BASELINE_ENFORCE=1`.
4. Agent Execution Directive: All automated maintenance, build, test, guard, and baseline operations MUST be executed via the MCP PowerShell server (`powershell-mcp-server`) using protocol tool `run-powershell` with explicit `timeout` (or `aiAgentTimeoutSec`) and, where supported, `workingdirectory`. Direct ad-hoc VSCode terminals by an AI agent are prohibited (signals knowledge regression). Commit hooks + tests enforce this directive.

Run guard manually:

```bash
BASELINE_ENFORCE=1 npm run guard:baseline
```

If this guard fails, do not add or modify tests—submit a change request instead.

Agent Execution Quick Reference:

| Action | MCP Command Pattern |
|--------|---------------------|
| Typecheck | `run-powershell { command: "npm run typecheck" }` |
| Guard (enforced) | `run-powershell { command: "$env:BASELINE_ENFORCE='1'; node scripts/guard-baseline.mjs" }` |
| Sentinel verify | `run-powershell { command: "node scripts/baseline-sentinel.mjs verify" }` |
| Minimal directive test | `run-powershell { command: "npx vitest run src/tests/mcpConfigImperativeDirective.spec.ts --reporter=dot" }` |

Any AI-initiated request for a raw terminal prompt is treated as policy violation.

## 🚀 Quick Start

### 1. Installation & Build

```bash
npm install
npm run build
```

### 2. Configuration

**For comprehensive configuration guidance, see [MCP Configuration Guide](./docs/MCP-CONFIGURATION.md)**

#### Basic Configuration (Development)

Create or update your MCP configuration:

```jsonc
{
  "servers": {
     "cwd": "C:/path/to/mcp-index-server",
      "type": "stdio",
      "command": "node",
      "cwd": "C:/github/jagilber/mcp-index-server", // adjust to your clone path
      "args": [
        "dist/server/index.js",            // relative because cwd is set
        "--dashboard",
        "--dashboard-port=3210"
      ],
      "env": {
        "MCP_LOG_VERBOSE": "1",
        "MCP_ENABLE_MUTATION": "1",
        "MCP_INSTRUCTIONS_DIR": "C:/github/jagilber/mcp-index-server/instructions"
      }
    }
  }
}
```

Notes:

* Ensure the `dist/server/index.js` file exists (run `npm run build` first).
* Set `MCP_INSTRUCTIONS_DIR` to the absolute path of your instructions folder (defaults to `./instructions` relative to server working directory).
* Use forward slashes or double-escaped backslashes in JSON.
* Remove any old workspace-level `.vscode/mcp.json` to prevent duplication.
* The first argument after `command` is executed by Node; with `cwd` set you can use a relative path (`dist/server/index.js`). Using an absolute path AND a `cwd` is redundant, not harmful.
* If you prefer absolute paths you may omit `cwd`.

### (Alternative) Workspace Configuration (Deprecated)

Previously you could add a `.vscode/mcp.json` inside the repo. This is no longer recommended and the template file has been removed to reduce confusion. Prefer the global file above.

### Minimal Snippet (No Dashboard)

```jsonc
{
  "servers": {
    "mcp-index-server": {
      "type": "stdio",
      "command": "node",
      "cwd": "C:/path/to/mcp-index-server",
      "args": ["dist/server/index.js"],
      "env": { 
        "MCP_LOG_VERBOSE": "1",
        "MCP_INSTRUCTIONS_DIR": "C:/path/to/mcp-index-server/instructions"
      }
    }
  }
}
```

### Legacy Example (For Reference Only)

If you still want the old style (not recommended):

Add to a workspace `.vscode/mcp.json` (file intentionally removed from repo to avoid accidental use):

```jsonc
{
  "servers": {
    "mcp-index-server": {
      "type": "stdio",
      "command": "node",
      "args": [
        "path/to/dist/server/index.js",
        "--dashboard",
        "--dashboard-port=3210"
      ],
      "env": {
        "MCP_LOG_VERBOSE": "1",
        "MCP_ENABLE_MUTATION": "1",
        "MCP_INSTRUCTIONS_DIR": "path/to/instructions"
      }
    }
  }
}
```

**Note**: Dashboard arguments are optional. The MCP protocol operates independently via stdio.

**Important**: After updating your global `mcp.json`, fully restart VS Code (not just reload) to establish the MCP server connection. If you change the path or rebuild, restart again.

### Why Were Paths Duplicated (Absolute + cwd)?

Earlier examples showed an absolute path inside `args` while also specifying a `cwd`. This works, but it is unnecessary duplication:

* `cwd` sets the working directory for the launched process.
* Node receives the script path from `args[0]`.
* If `cwd` is set, you can safely use a relative path (`dist/server/index.js`).
* Keeping both absolute path and `cwd` can obscure portability (moving the clone requires editing two places).

Recommended patterns:

1. Portable (preferred):

   ```jsonc
   {
     "type": "stdio",
     "command": "node",
     "cwd": "C:/path/to/mcp-index-server",
     "args": ["dist/server/index.js"]
   }
   ```

2. Absolute only (omit cwd):

   ```jsonc
   {
     "type": "stdio",
     "command": "node",
     "args": ["C:/path/to/mcp-index-server/dist/server/index.js"]
   }
   ```

Both are valid; choose one for consistency.

### Critical MCP Functions

* **`tools/list`**: Enumerates all tools (SDK handler)
* **`tools/call`**: Executes tools with schema validation (SDK handler)
* **`ping`**: Lightweight latency / reachability probe (after successful initialize)
* **Initialize `instructions`**: Human-readable quick start guidance included in initialize result
* **Protocol compliance**: Provide `protocolVersion`, `clientInfo`, and `capabilities` in `initialize`; expect `server/ready` notification

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

## Key Features

* ✅ **MCP Protocol Compliance**: Full JSON-RPC 2.0 over stdio transport
* ✅ **Tool Discovery**: 17+ tools with JSON schemas for client validation
* ✅ **Instruction Management**: list/get/search/diff/import/export/repair/reload
* ✅ **Usage Analytics**: track/hotset/flush with persistent storage
* ✅ **Governance**: integrity/verify, gates/evaluate, prompt/review
* ✅ **Security**: Input validation, mutation gating, audit logging
* ✅ **Performance**: Optimized for <50ms response times

### Available Tools

## Instruction Governance (v0.7.0+)

Each instruction JSON now includes lifecycle metadata: version, status, owner, priorityTier, classification, review timestamps, and changelog.

Alpha semantics (current): The server now preserves any governance fields you explicitly supply on add/import (version, owner, priorityTier, semanticSummary, etc.) without auto-bumping or overriding. Defaults are only filled for fields you omit. Previous automatic version patch bumps on body changes have been removed for simplicity and determinism.

Supporting automation:

* Lint: `npm run lint:instructions`
* Governance CI workflow: `.github/workflows/instruction-governance.yml`
* Daily snapshot archival: `.github/workflows/instruction-snapshot.yml` (outputs `snapshots/catalog-*.json` + checksum)

Primary tool groups:

* **Instructions**: `list`, `get`, `search`, `export`, `diff`, `import`, `add`, `repair`, `reload`, `remove`, `enrich`
* **Governance Patch**: `governanceUpdate` (controlled mutation of owner, status, review timestamps + optional version bump)
* **Usage Tracking**: `track`, `hotset`, `flush`
* **Governance Analysis**: `integrity/verify`, `gates/evaluate`, `prompt/review`, `governanceHash`
* **System**: `health/check`, `metrics/snapshot`, `meta/tools`

### Simplified Authoring Schema (Tier 1)

Author-facing JSON requires only the minimal core fields; all omitted governance fields are derived, but any governance fields you DO provide are preserved as-is:

```jsonc
{ "id": "...", "title": "...", "body": "...", "priority": 50, "audience": "all", "requirement": "optional", "categories": ["example"] }
```

If omitted, governance & lifecycle fields (version, status, owner, priorityTier, classification, review dates, changeLog, semanticSummary, sourceHash) are derived at load time. The `instructions/enrich` tool will not overwrite explicit values you supplied; it only fills gaps.

### governanceUpdate Tool

Use `instructions/governanceUpdate` to patch a limited set of governance fields without re-importing the full instruction body.

Input params:

```jsonc
{ "id": "rule-123", "owner": "team:platform", "status": "approved", "bump": "patch" }
```

Supported bumps: `patch|minor|major|none` (default `none`). Only writes when a change occurs; returns `{ changed:false }` if idempotent.

Typical workflow:

1. Author minimal file (omit governance fields) in `instructions/`.
2. Server loads & derives governance automatically.
3. (Optional) Run `instructions/enrich` to persist derived fields for audit stability.
4. Later adjust owner/status or force version bump with `instructions/governanceUpdate`.


Rationale: Keeps authoring friction low while making CRUD semantics deterministic—no hidden or retroactive mutation of provided governance values. Hash stability and CI gating operate on exactly what you wrote plus only defaulted fields.

## Usage

### MCP Client Usage (VS Code, Claude, etc.)

```bash
# Server runs automatically when VS Code starts
# All communication via stdio - no manual intervention needed
node dist/server/index.js
```

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

### Handshake Reliability (1.1.1)

As of 1.1.1 the legacy short-circuit handshake flag (`MCP_SHORTCIRCUIT`) was removed. All tests and clients MUST use the canonical MCP SDK initialize sequence:

1. Client spawns server process.
2. Server buffers early stdin until SDK ready (guards against dropped initialize in fast clients).
3. Client sends a single `initialize` (id=1). Helper may resend once if no frame observed (idempotent per spec).
4. Server responds with initialize result, then emits exactly one `server/ready`, optionally followed by `tools/list_changed`.

Test harness specs requiring direct process spawn MUST use the shared helper `performHandshake()` in `src/tests/util/handshakeHelper.ts` rather than bespoke timing loops. This ensures consistent startup behavior and eliminates intermittent initialize timeouts under parallel suite load.

Diagnostic flags affecting handshake (`MCP_INIT_FALLBACK_ALLOW`, `MCP_DISABLE_INIT_SNIFF`, `MCP_HANDSHAKE_TRACE`) are for investigation only and MUST remain unset in production deployments.

## Testing

Comprehensive green test suite (no skipped tests) covering:

* MCP protocol compliance & transport (initialize, tools/list, tools/call, ping, server/ready notification)
* Dispatcher actions (list, listScoped, get, search, diff, export, query, batch, capabilities, governanceHash, grooming, enrichment, governanceUpdate)
* Input validation & error paths (unknown action/method, malformed JSON-RPC envelope)
* Governance hashing, integrity verification, and persistence/restart continuity
* Usage tracking/rate limiting, feature gating, metrics snapshot
* Enrichment / grooming behaviors & property-based idempotence (seeded for determinism)
* Security hardening (prompt size limits, null byte sanitation) & prompt review criteria

Run tests: `npm test` (updated for 1.0.0 – legacy alias & direct method tests removed)

Contract-only schema verification: `npm run test:contracts` (3 focused contract tests)

## Architecture

* **MCP Transport**: JSON-RPC 2.0 over stdio (client communication)
* **HTTP Dashboard**: Optional localhost web interface (admin monitoring)
* **Validation**: AJV-based input schema validation with fail-open fallback
* **Registry**: Centralized tool metadata with input/output schemas for client validation
* **Persistence**: File-based instruction storage with usage analytics
* **Gating**: Environment-controlled mutation access with audit logging

## Status

✅ **Phase 1 Complete**: Full MCP protocol implementation with VS Code integration support

* Core JSON-RPC 2.0 transport over stdio
* Standard MCP protocol handlers (`initialize`, `tools/list`, `tools/call`)
* Tool registry with input/output schemas for client validation
* **Feedback/Emit System**: Enterprise-grade client communication system (6 tools)
* Comprehensive test suite (181+ tests, 93+ test files)
* Optional admin dashboard with read-only interface

### 📢 **Feedback System Features**

The server includes a comprehensive feedback/emit system for client-server communication:

* **6 MCP Tools**: `feedback/submit`, `feedback/list`, `feedback/get`, `feedback/update`, `feedback/stats`, `feedback/health`
* **Rich Feedback Types**: Issues, bug reports, feature requests, security reports, performance feedback
* **Status Workflow**: new → acknowledged → in-progress → resolved → closed
* **Enterprise Features**: Audit logging, persistence, filtering, pagination (up to 200 entries)
* **Security**: Critical/security items logged separately with alerts

Hooks: Pre-commit runs typecheck, lint, tests, and security scan. Manual scan: `npm run scan:security`.

## Roadmap

See `docs/DASHBOARD-DEVELOPMENT-PLAN.md` and `docs/ARCHITECTURE.md` for detailed planning.
