# Portable MCP Client Bundle

Minimal, self-contained generic MCP client utilities suitable for copying into another workspace or distributing as a zip archive.

## Included Tools

- `generic-client.mjs` – Enumerate tools (`tools/list`), invoke a tool immediately (first call), batch invoke all, interactive schema prompting, describe tool schema (`--describe`), REPL session (`--repl`).
- `index-crud-client.mjs` – Turn‑key CRUD scenario runner for instruction/index style servers exposing `instructions/add|get|list|remove` tools.
- `index-count-client.mjs` – Lightweight instruction count probe (dispatcher or legacy fallback) returning count/hash.
- `ops-crud-client.mjs` – Discrete create/read/update/delete/list operations & full CRUD sequence (`--crud`).
- `client-lib.mjs` – Shared helpers (connect + CRUD orchestration + entry generation).
- `package.json` – Declares SDK dependency and convenience scripts.

## Quick Usage

```bash
# Install dependencies
npm install

# List tools on an MCP server binary in PATH (example: mcp-index-server)
node generic-client.mjs --command mcp-index-server --list --json

# Describe a tool schema
node generic-client.mjs --command mcp-index-server --describe instructions/add

# Invoke a tool immediately on first connection
node generic-client.mjs --command mcp-index-server \
  --tool instructions/add \
  --tool-args '{"id":"demo-1","title":"Title 1","body":"Example body"}' --json

# Run CRUD scenario (add/list/get/remove) with 3 generated entries
node index-crud-client.mjs --command mcp-index-server --entries 3 --json

# Count instructions only
node index-count-client.mjs --command mcp-index-server --json

# Individual operations
node ops-crud-client.mjs --create --id demo1 --body "Hello" --json
node ops-crud-client.mjs --read --id demo1 --json
node ops-crud-client.mjs --update --id demo1 --body "Updated" --json
node ops-crud-client.mjs --delete --id demo1 --json

# Full CRUD sequence
node ops-crud-client.mjs --crud --id demo2 --body "Start" --update-body "Finish" --json

# Start a persistent REPL
node generic-client.mjs --command mcp-index-server --repl
```

## Scripts (npm run ...)

- `generic:list` – list tools (JSON)
- `generic:echo` – echo demo for minimal server
- `generic:describe:echo` – show echo tool schema
- `generic:repl` – start REPL against default demo server
- `crud` – CRUD scenario (demo default path)
- `crud:index` – CRUD scenario targeting an `mcp-index-server` in PATH

## Exit Codes

- `0` success
- `1` usage / argument parsing error
- `2` one or more tool invocation failures

## Packaging

A PowerShell script `Build-PortableZip.ps1` (at repo root portable folder) produces `dist/portable-mcp-client.zip` containing just the portable essentials.

## Notes

- All tool discovery and schemas come purely from runtime protocol (`tools/list`) – no server source inspection required.
- If a server restarts during a REPL session, restart the client; a future enhancement may add `:refresh`.
- Pin or lock the `@modelcontextprotocol/sdk` version for strict reproducibility if embedding in critical workflows.
