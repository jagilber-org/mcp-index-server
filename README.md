# MCP Index Server

> **Portfolio Project** | [View Full Portfolio](https://github.com/jagilber-org) | [Specifications](docs/specs/)

![UI Drift Detection](https://github.com/jagilber/mcp-index-server/actions/workflows/ui-drift.yml/badge.svg)

**[📋 Product Requirements (PROJECT_PRD.md)](./docs/PROJECT_PRD.md)** – Authoritative binding requirements and governance

* **[🔧 API Reference (TOOLS.md)](./docs/TOOLS.md)** - Complete MCP protocol-compliant tool documentation  
* **[📦 Manifest & Materialization (MANIFEST.md)](./docs/MANIFEST.md)** - Catalog manifest lifecycle & opportunistic materialization semantics
* **[⚙️ Configuration Guide (MCP-CONFIGURATION.md)](./docs/MCP-CONFIGURATION.md)** - Comprehensive MCP setup patterns for all environments
* **[🔧 Server Configuration (CONFIGURATION.md)](./docs/CONFIGURATION.md)** - Environment variables and CLI options reference
* **[�️ Admin Dashboard Guide (DASHBOARD.md)](./docs/DASHBOARD.md)** - UI features, screenshots, drift monitoring & maintenance
  * Includes baseline visual snapshots (system health, performance CPU+Memory card, instruction list, editor, log tail, graph raw + rendered) maintained via Playwright @baseline tests.
* **[�📊 Dashboard Development Plan (DASHBOARD-DEVELOPMENT-PLAN.md)](./docs/DASHBOARD-DEVELOPMENT-PLAN.md)** - Multi-phase dashboard enhancement roadmap
* **[📝 Content Guidance (CONTENT-GUIDANCE.md)](./docs/CONTENT-GUIDANCE.md)** - What to include in local vs. central instruction servers
* **[🧠 Prompt Optimization (PROMPT-OPTIMIZATION.md)](./docs/PROMPT-OPTIMIZATION.md)** - AI prompt handling and optimization guide
* **[🔍 Portable Test Client (PORTABLE-MCP-TEST-CLIENT.md)](./docs/PORTABLE-MCP-TEST-CLIENT.md)** - Critical testing tool for MCP troubleshooting
* **[🏗️ Architecture (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)** - System design and component overview
* **[🔒 Security (SECURITY.md)](./SECURITY.md)** - Security policies and compliance
* **[🚦 CI Investigation (CI-INVESTIGATION-2025-09-24.md)](./docs/CI-INVESTIGATION-2025-09-24.md)** - Latest analysis of skip guard and build verification failures

Enterprise-grade local Model Context Protocol server providing a governed, classified, auditable instruction catalog with analytics and optional admin dashboard.

## 📚 **Complete Documentation Suite**

This project provides comprehensive enterprise-grade documentation:

* **[📋 Product Requirements (PROJECT_PRD.md)](./docs/PROJECT_PRD.md)** – Authoritative binding requirements and governance
* **[🔧 API Reference (TOOLS.md)](./docs/TOOLS.md)** – Complete MCP protocol-compliant tool documentation  
* **[📦 Manifest & Materialization (MANIFEST.md)](./docs/MANIFEST.md)** – Catalog manifest lifecycle & opportunistic materialization semantics
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
* **[📜 Constitution (memory/constitution.md)](./memory/constitution.md)** – Governance & categories (spec-kit adapted)
* **[🧩 Bootstrap Spec 000 (specs/000-bootstrapper.md)](./specs/000-bootstrapper.md)** – Minimal dual-layer model (P1 bootstrapper)
* **[🔁 Lifecycle Spec 001 (specs/001-knowledge-index-lifecycle.md)](./specs/001-knowledge-index-lifecycle.md)** – Local-first capture → promotion workflow (P1 lifecycle)

### Recent Additions (1.4.x)

* **Manifest Subsystem** – Centralized helper + counters (`manifest:write*`), disable flag (`MCP_MANIFEST_WRITE=0`), future fastload placeholder.
* **Opportunistic Materialization** – Race-free in-memory add visibility (formerly "late materialization").
* **Feedback System** – (Previously formalized) 6 MCP tools with audit & security logging.
* **PRD 1.4.2** – Added manifest & materialization requirements; deprecated PRD stubs removed.
* **Spec-Kit Integration** – Added constitution + sequential P1 specs (bootstrapper, lifecycle) with authoring template.

### Runtime Configuration Consolidation (Phases 1–4 Completed)

The environment flag surface has been consolidated under a single typed loader (`runtimeConfig.ts`) to reduce proliferation and ease test/runtime tuning.

Key consolidated variables (see `docs/CONFIGURATION.md` for full table):

| Domain | New Primary Variable | Example | Notes |
|--------|----------------------|---------|-------|
| Timing | `MCP_TIMING_JSON` | `{ "manifest.waitDisabled":18000, "manifest.waitRepair":20000 }` | Replaces scattered `MANIFEST_TEST_WAIT_*` vars; additive keys allowed |
| Coverage | `MCP_TEST_MODE` | `coverage-fast` | Supersedes ad-hoc `FAST_COVERAGE=1` usage (legacy still honored) |
| Logging | `MCP_LOG_LEVEL` | `debug` | Normalized levels: `silent,error,warn,info,debug,trace` |
| Mutation | `MCP_MUTATION` | `enabled` / `disabled` | Wraps legacy `MCP_ENABLE_MUTATION` (still accepted) |
| Trace Tokens | `MCP_TRACE` | `manifest,bootstrap` | Composable, replaces multiple boolean verbose flags over time |
| Buffer Ring | `MCP_BUFFER_RING` (planned) | `append:4096` | Placeholder – existing flags still active until Phase 5 |
| Coverage Thresholds | `COVERAGE_HARD_MIN` / `COVERAGE_TARGET` | `50 / 60` | Still exported; accessed via runtimeConfig.coverage.* |

Migration guidance:

* Continue using legacy flags temporarily; deprecation warnings emit once per process when translation occurs.
* Prefer adding new timing overrides via `MCP_TIMING_JSON` rather than introducing new top-level env vars.
* Tests should obtain values via `getRuntimeConfig().timing(key, fallback)` instead of `process.env.*`.
* Future Phase 5 will introduce an optional strict mode (`MCP_CONFIG_STRICT=1`) that fails startup on unrecognized legacy flags once migration coverage ≥70%.

Example timing override (PowerShell):

```powershell
$env:MCP_TIMING_JSON = '{"manifest.waitDisabled":15000,"manifest.postKill":400}'
```

Access in code:

```ts
import { getRuntimeConfig } from './config/runtimeConfig';
const cfg = getRuntimeConfig();
const waitDisabled = cfg.timing('manifest.waitDisabled', 18000);
```

Backward compatibility: The following legacy variables are auto-mapped with one-time warnings:

| Legacy | Replacement | Status |
|--------|-------------|--------|
| `MANIFEST_TEST_WAIT_DISABLED_MS` | `MCP_TIMING_JSON: manifest.waitDisabled` | Deprecated – still works |
| `MANIFEST_TEST_WAIT_REPAIR_MS` | `MCP_TIMING_JSON: manifest.waitRepair` | Deprecated – still works |
| `FAST_COVERAGE` | `MCP_TEST_MODE=coverage-fast` | Deprecated – still works |
| `MCP_ENABLE_MUTATION` | `MCP_MUTATION=enabled` | Deprecated – still works |

Report any missing mapping candidates so they can be folded into the loader instead of adding new ad-hoc flags.

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

## Portfolio Context

This project is part of the [jagilber-org portfolio](https://github.com/jagilber-org), demonstrating advanced MCP server patterns and agent development practices.

**Cross-Project Integration**:
- Instruction catalog system used by all portfolio MCP servers
- Governance and validation patterns for **obfuscate-mcp-server** and **powershell-mcp-server**
- Reference implementation for MCP server indexing and discovery
- Agent development best practices shared across portfolio

**Portfolio Highlights**:
- Production-ready instruction catalog with 100+ enterprise patterns
- Graph-based instruction relationships and dependencies
- Comprehensive governance system (ownership, review, deprecation)
- Bootstrap security and confirmation workflows
- Real-world MCP server architecture patterns

[View Full Portfolio](https://github.com/jagilber-org) | [Integration Examples](https://github.com/jagilber-org#cross-project-integration)

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

## Configuration

For complete configuration details including:
- **VS Code Integration & Troubleshooting** - Connection setup, timeout issues, stdio debugging
- **Local Production Deployment** - Production setup at c:\mcp with service configuration
- **Security & Mutation Control** - Bootstrap confirmation workflow and guarded operations

**📖 See: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)**

### Quick VS Code Setup

```json
{
  "mcpServers": {
    "mcp-index-server": {
      "command": "node",
      "args": ["C:\\mcp\\mcp-index-server\\build\\index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Key Features

* ✅ **MCP Protocol Compliance**: Full JSON-RPC 2.0 over stdio transport
* ✅ **Tool Discovery**: 17+ tools with JSON schemas for client validation
* ✅ **Instruction Management**: list/get/search/diff/import/export/repair/reload
* ✅ **Usage Analytics**: track/hotset/flush with persistent storage
* ✅ **Governance**: integrity/verify, gates/evaluate, prompt/review
* ✅ **Security**: Input validation, mutation gating, audit logging
* ✅ **Performance**: Optimized for <50ms response times

### 🔑 Bootstrap Flow (Activation & Gating)

The server guarantees presence of two minimal bootstrap seed instructions (`000-bootstrapper`, `001-lifecycle-bootstrap`). On startup, if they are missing (fresh or empty instructions directory) they are automatically created (non-destructive – existing files are never overwritten). Disable with `MCP_AUTO_SEED=0`. Verbose seed logging: `MCP_SEED_VERBOSE=1`.

Auto-seeding summary events are logged as `seed_summary` with fields: `created[]`, `existing[]`, `disabled`, and a deterministic `hash` of canonical seed content for audit reproducibility.

Environment variables relevant to seeding:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_AUTO_SEED` | 1 | Create missing bootstrap seeds if absent (never overwrite) |
| `MCP_SEED_VERBOSE` | 0 | Emit stderr diagnostic line with counts and hash |

Idempotency: Subsequent restarts find existing seeds and perform no writes; multi-instance race conditions are harmless due to atomic write + rename pattern.

Bootstrap tools:

* `bootstrap/status` – Inspect current gating state (referenceMode, confirmed, requireConfirmation)
* `bootstrap/request` – Issue one-time confirmation token (hash persisted only)
* `bootstrap/confirmFinalize` – Finalize activation using token

Workspace states:

| State | Conditions | Mutation | Notes |
|-------|-----------|----------|-------|
| Reference Mode | `MCP_REFERENCE_MODE=1` | Blocked | Read-only reference server (never mutates) |
| Fresh | Only bootstrap seeds present, no confirmation file | Blocked (reason=bootstrap_confirmation_required) | Request + finalize to enable |
| Pending | Token issued, not finalized | Blocked | Re-request if expired |
| Confirmed | Confirmation file written | Allowed (subject to `MCP_ENABLE_MUTATION`) | Persistent across restarts |
| Existing | Any non-bootstrap instruction already present | Allowed | Treated as implicitly active |

Error contract examples:

```jsonc
{ "error":"mutation_blocked", "reason":"bootstrap_confirmation_required" }
{ "error":"mutation_blocked", "reason":"reference_mode_read_only" }
{ "result": { "error":"token_expired" } }
```

Token lifecycle:

1. `bootstrap/request` → returns `{ token, expiresAt }`
2. Human reviews rationale & approves
3. `bootstrap/confirmFinalize` with token → writes confirmation file
4. Dispatcher mutation actions now proceed (if mutation not globally disabled)

Recursion risk: bootstrap IDs are allowlisted and subtracted from governance leakage metrics—`instructions/health` should continue to report `recursionRisk: "none"` after activation.

Reference-only deployments: set `MCP_REFERENCE_MODE=1` to expose catalog safely to exploratory agents without risk of mutation.


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

## 📚 Documentation

### Specifications

- **[Product Specification](docs/specs/spec.md)** - User scenarios, functional requirements, success criteria, integration points
- **[Technical Plan](docs/specs/plan.md)** - Architecture, implementation phases, performance benchmarks

### Project Documentation

- [Full Documentation Index](docs/) - Comprehensive guides and references
## Usage

### MCP Client Usage (VS Code, Claude, etc.)

```bash
# Server runs automatically when VS Code starts
# All communication via stdio - no manual intervention needed
node dist/server/index.js
```

### 🔍 **Recommended Search-First Workflow**

**For MCP clients and agents, use this pattern to efficiently discover and retrieve instructions:**

1. **🔍 Search First** - Use `instructions/search` to find relevant instruction IDs:

   ```json
   {
     "method": "tools/call",
     "params": {
       "name": "instructions/search",
       "arguments": {
         "keywords": ["javascript", "arrays"],
         "limit": 10,
         "includeCategories": true
       }
     }
   }
   ```

2. **📝 Get Details** - Use `instructions/dispatch` with `get` action for full instruction content:

   ```json
   {
     "method": "tools/call", 
     "params": {
       "name": "instructions/dispatch",
       "arguments": {
         "action": "get",
         "id": "instruction-id-from-search"
       }
     }
   }
   ```

**Why This Pattern?**

* ✅ **Efficient**: Search returns only IDs, not full content
* ✅ **Fast**: Keyword search is optimized for performance  
* ✅ **Scalable**: Works well with large instruction catalogs
* ✅ **Targeted**: Get only the instructions you need
* ✅ **MCP Compliant**: Follows MCP tool discovery best practices

**Search Features:**

* Multi-keyword support with relevance scoring
* Case-sensitive and case-insensitive options
* Search across titles, bodies, and optionally categories
* Input validation and error handling
* Configurable result limits (1-100)

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
