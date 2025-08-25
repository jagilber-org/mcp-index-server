# MCP Instruction Server

Enterprise-grade local Model Context Protocol server providing a governed, classified, auditable instruction catalog with analytics and optional admin dashboard.

## Transport Architecture

### MCP Protocol (Client Communication)

- **Transport**: JSON-RPC 2.0 over **stdio only**
- **Purpose**: VS Code, Claude, and other MCP clients communicate via stdin/stdout
- **Security**: No network exposure, process-isolated communication
- **Tools**: All 17+ instruction management tools available via MCP protocol

### Admin Dashboard (Optional)

- **Transport**: HTTP server on localhost (admin access only)
- **Purpose**: Human-readable interface for administrators to monitor server status
- **Security**: Read-only by default, localhost binding, no remote access
- **Access**: Local administrators only (not for end users or MCP clients)

**Important**: MCP clients (like VS Code) connect via stdio transport only, not HTTP dashboard.

## VS Code Integration

This server is fully compatible with VS Code MCP clients and GitHub Copilot agent mode.

### Configuration

Add to your VS Code `mcp.json`:

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

**Important**: After updating your `mcp.json`, restart VS Code completely to establish the MCP server connection.

### Critical MCP Functions

- **`tools/list`**: Returns all 17+ available tools with JSON schemas for validation
- **`tools/call`**: Executes tools by name with parameter validation
- **Protocol compliance**: Proper `initialize` handshake and `server/ready` notifications

## Troubleshooting VS Code Connection

If VS Code shows "Configured but Not Connected":

1. **Build the server**: Ensure `dist/server/index.js` exists by running `npm run build`
2. **Check the path**: Use absolute path to the server executable in your `mcp.json`
3. **Restart VS Code**: MCP connections require a full VS Code restart after configuration changes
4. **Test manually**: Verify the server works by running:

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server/index.js
   ```

5. **Check logs**: Enable `MCP_LOG_VERBOSE=1` to see connection details in VS Code developer console

## Key Features

- ✅ **MCP Protocol Compliance**: Full JSON-RPC 2.0 over stdio transport
- ✅ **Tool Discovery**: 17+ tools with JSON schemas for client validation
- ✅ **Instruction Management**: list/get/search/diff/import/export/repair/reload
- ✅ **Usage Analytics**: track/hotset/flush with persistent storage
- ✅ **Governance**: integrity/verify, gates/evaluate, prompt/review
- ✅ **Security**: Input validation, mutation gating, audit logging
- ✅ **Performance**: Optimized for <50ms response times

### Available Tools

- **Instructions**: `list`, `get`, `search`, `export`, `diff`, `import`, `repair`, `reload`
- **Usage Tracking**: `track`, `hotset`, `flush`
- **Governance**: `integrity/verify`, `gates/evaluate`, `prompt/review`
- **System**: `health/check`, `metrics/snapshot`, `meta/tools`

## Usage

### MCP Client Usage (VS Code, Claude, etc.)

```bash
# Server runs automatically when VS Code starts
# All communication via stdio - no manual intervention needed
node dist/server/index.js
```

### Admin Dashboard Usage (Optional)

```bash
# For administrators only - not for MCP clients
node dist/server/index.js --dashboard --dashboard-port=3210
# Dashboard accessible at http://localhost:3210
```

### Development

1. Install dependencies: `npm ci`
2. Build: `npm run build`
3. Test: `npm test`
4. Run: `node dist/server/index.js`

## Security & Mutation Control

- **MCP_ENABLE_MUTATION=1**: Enables write operations (import, repair, reload, flush)
- **MCP_LOG_VERBOSE=1**: Detailed logging for debugging
- **Input validation**: AJV-based schema validation with fail-open fallback
- **Gated mutations**: Write operations require explicit environment flag
- **Process isolation**: MCP clients communicate via stdio only (no network access)

## Testing

Comprehensive test coverage including:

- **MCP protocol compliance** tests (`mcpProtocol.spec.ts`)
- **Input validation** and parameter checking
- **Tool registry** and schema validation
- **Contract testing** for API stability
- **Security hardening** and edge cases

Run tests: `npm test` (28 tests across 14 files)

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
