# MCP Instruction Server

Enterprise-grade local Model Context Protocol server providing a governed, classified, auditable instruction catalog with analytics and optional admin dashboard.

## Transport Architecture

### MCP Protocol (Client Communication)

Windows: `%APPDATA%/Code/User/mcp.json`  
Example full path: `C:\\Users\\<you>\\AppData\\Roaming\\Code\\User\\mcp.json`
 
- **Security**: No network exposure, process-isolated communication
- **Tools**: All 17+ instruction management tools available via MCP protocol

### Admin Dashboard (Optional)

- **Transport**: HTTP server on localhost (admin access only)
- **Purpose**: Human-readable interface for administrators to monitor server status
  "cwd": "C:/path/to/mcp-index-server", // adjust to your local clone path
- **Access**: Local administrators only (not for end users or MCP clients)

**Important**: MCP clients (like VS Code) connect via stdio transport only, not HTTP dashboard.

### SDK Implementation

This server now runs exclusively on the official `@modelcontextprotocol/sdk` (no legacy transport). Benefits:

- Automatic capabilities advertisement (`capabilities.tools` with `listChanged`)
- Consistent framing & future-proofing (resources, prompts, etc.)
- Reduced maintenance surface (custom JSON-RPC loop removed)

All previous tool handlers are preserved through an internal registry consumed by the SDK server.

## VS Code Integration

This server is fully compatible with VS Code MCP clients and GitHub Copilot agent mode.

### Configuration

You can configure the server either per-workspace or (recommended) globally. To avoid conflicts, this project now expects ONLY a global MCP configuration.

### Global Configuration (Recommended)

  "cwd": "C:/path/to/mcp-index-server",

Windows: `%APPDATA%/Code/User/mcp.json`  
Example full path: `C:\\Users\\<you>\\AppData\\Roaming\\Code\\User\\mcp.json`

Add (or merge) this entry:

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
        "MCP_ENABLE_MUTATION": "1"
      }
    }
  }
}
```

Notes:

- Ensure the `dist/server/index.js` file exists (run `npm run build` first).
- Use forward slashes or double-escaped backslashes in JSON.
- Remove any old workspace-level `.vscode/mcp.json` to prevent duplication.
- The first argument after `command` is executed by Node; with `cwd` set you can use a relative path (`dist/server/index.js`). Using an absolute path AND a `cwd` is redundant, not harmful.
- If you prefer absolute paths you may omit `cwd`.

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
      "env": { "MCP_LOG_VERBOSE": "1" }
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
        "MCP_ENABLE_MUTATION": "1"
      }
    }
  }
}
```

**Note**: Dashboard arguments are optional. The MCP protocol operates independently via stdio.

**Important**: After updating your global `mcp.json`, fully restart VS Code (not just reload) to establish the MCP server connection. If you change the path or rebuild, restart again.

### Why Were Paths Duplicated (Absolute + cwd)?

Earlier examples showed an absolute path inside `args` while also specifying a `cwd`. This works, but it is unnecessary duplication:

- `cwd` sets the working directory for the launched process.
- Node receives the script path from `args[0]`.
- If `cwd` is set, you can safely use a relative path (`dist/server/index.js`).
- Keeping both absolute path and `cwd` can obscure portability (moving the clone requires editing two places).

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

- **`tools/list`**: Enumerates all tools (SDK handler)
- **`tools/call`**: Executes tools with schema validation (SDK handler)
- **`ping`**: Lightweight latency / reachability probe (after successful initialize)
- **Initialize `instructions`**: Human-readable quick start guidance included in initialize result
- **Protocol compliance**: Provide `protocolVersion`, `clientInfo`, and `capabilities` in `initialize`; expect `server/ready` notification

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

- ✅ **MCP Protocol Compliance**: Full JSON-RPC 2.0 over stdio transport
- ✅ **Tool Discovery**: 17+ tools with JSON schemas for client validation
- ✅ **Instruction Management**: list/get/search/diff/import/export/repair/reload
- ✅ **Usage Analytics**: track/hotset/flush with persistent storage
- ✅ **Governance**: integrity/verify, gates/evaluate, prompt/review
- ✅ **Security**: Input validation, mutation gating, audit logging
- ✅ **Performance**: Optimized for <50ms response times

### Available Tools

## Instruction Governance (v0.7.0+)

Each instruction JSON now includes lifecycle metadata: version, status, owner, priorityTier, classification, review timestamps, and changelog.

Alpha semantics (current): The server now preserves any governance fields you explicitly supply on add/import (version, owner, priorityTier, semanticSummary, etc.) without auto-bumping or overriding. Defaults are only filled for fields you omit. Previous automatic version patch bumps on body changes have been removed for simplicity and determinism.

Supporting automation:

- Lint: `npm run lint:instructions`
- Governance CI workflow: `.github/workflows/instruction-governance.yml`
- Daily snapshot archival: `.github/workflows/instruction-snapshot.yml` (outputs `snapshots/catalog-*.json` + checksum)

Primary tool groups:

- **Instructions**: `list`, `get`, `search`, `export`, `diff`, `import`, `add`, `repair`, `reload`, `remove`, `enrich`
- **Governance Patch**: `governanceUpdate` (controlled mutation of owner, status, review timestamps + optional version bump)
- **Usage Tracking**: `track`, `hotset`, `flush`
- **Governance Analysis**: `integrity/verify`, `gates/evaluate`, `prompt/review`, `governanceHash`
- **System**: `health/check`, `metrics/snapshot`, `meta/tools`

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

Steps:

1. Build locally (if not already):

  ```powershell
  npm run build
  ```

1. Deploy:

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

- The deploy script skips copying transient or fuzz / concurrent temp instruction files.
- Re-run the deploy with `-Overwrite` to refresh everything (will replace runtime copy).
- Governance & usage data live inside the instruction JSON files; a simple file backup is your persistence strategy.

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

## Security & Mutation Control

- **MCP_ENABLE_MUTATION=1**: Enables write operations (import, repair, reload, flush)
- **MCP_LOG_VERBOSE=1**: Detailed logging for debugging
- **Input validation**: AJV-based schema validation with fail-open fallback

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

- **Gated mutations**: Write operations require explicit environment flag
- **Process isolation**: MCP clients communicate via stdio only (no network access)

## Testing

Comprehensive green test suite (no skipped tests) covering:

- MCP protocol compliance & transport (initialize, tools/list, tools/call, ping, server/ready notification)
- Dispatcher actions (list, listScoped, get, search, diff, export, query, batch, capabilities, governanceHash, grooming, enrichment, governanceUpdate)
- Input validation & error paths (unknown action/method, malformed JSON-RPC envelope)
- Governance hashing, integrity verification, and persistence/restart continuity
- Usage tracking/rate limiting, feature gating, metrics snapshot
- Enrichment / grooming behaviors & property-based idempotence (seeded for determinism)
- Security hardening (prompt size limits, null byte sanitation) & prompt review criteria

Run tests: `npm test` (updated for 1.0.0 – legacy alias & direct method tests removed)

Contract-only schema verification: `npm run test:contracts` (3 focused contract tests)

## Architecture

- **MCP Transport**: JSON-RPC 2.0 over stdio (client communication)
- **HTTP Dashboard**: Optional localhost web interface (admin monitoring)
- **Validation**: AJV-based input schema validation with fail-open fallback
- **Registry**: Centralized tool metadata with input/output schemas
- **Persistence**: File-based instruction storage with usage analytics
- **Gating**: Environment-controlled mutation access with audit logging

## Status

✅ **Phase 1 Complete**: Full MCP protocol implementation with VS Code integration support

- Core JSON-RPC 2.0 transport over stdio
- Standard MCP protocol handlers (`initialize`, `tools/list`, `tools/call`)
- Tool registry with input/output schemas for client validation
- Comprehensive test suite (28 tests, 14 test files)
- Optional admin dashboard with read-only interface

Hooks: Pre-commit runs typecheck, lint, tests, and security scan. Manual scan: `npm run scan:security`.

## Roadmap

See `docs/IMPLEMENTATION-PLAN.md` and `docs/ARCHITECTURE.md` for detailed planning.
