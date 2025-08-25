# MCP Instruction### Configuration

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

**Important**: After updating your `mcp.json`, restart VS Code completely to establish the MCP server connection.

## Troubleshooting VS Code Connection

If VS Code shows "Configured but Not Connected":

1. **Build the server**: Ensure `dist/server/index.js` exists by running `npm run build`
2. **Check the path**: Use absolute path to the server executable in your `mcp.json`
3. **Restart VS Code**: MCP connections require a full VS Code restart after configuration changes
4. **Test manually**: Verify the server works by running:

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server/index.js
   ```

5. **Check logs**: Enable `MCP_LOG_VERBOSE=1` to see connection details in VS Code developer consoleterprise-grade local Model Context Protocol server providing a governed, classified, auditable instruction catalog with analytics and a management dashboard.

## Status

✅ **Phase 1 Complete**: Full MCP protocol implementation with VS Code integration support

- Core JSON-RPC 2.0 transport over stdio
- Standard MCP protocol handlers (`initialize`, `tools/list`, `tools/call`)
- Tool registry with input/output schemas for client validation
- Comprehensive test suite (23 tests, 13 test files)

## VS Code Integration

This server is fully compatible with VS Code MCP clients and GitHub Copilot agent mode.

### Configuration

Add to your VS Code `mcp.json`:

```jsonc
{
  "servers": {
    "mcp-instruction-server": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/dist/server/index.js"],
      "env": {
        "MCP_LOG_VERBOSE": "1",
        "MCP_ENABLE_MUTATION": "1"
      }
    }
  }
}
```

### Critical MCP Functions

- **`tools/list`**: Returns all 17+ available tools with JSON schemas for validation
- **`tools/call`**: Executes tools by name with parameter validation
- **Protocol compliance**: Proper `initialize` handshake and `server/ready` notifications

## Key Features

- ✅ Deterministic catalog loading with hashing & integrity verification
- ✅ Rich classification: audience (individual|group|all), requirement (mandatory|critical|recommended|optional|deprecated), categories, risk scoring
- ✅ Tools: list/get/search/diff, usage tracking, integrity & drift reports, gate evaluation, metrics
- ✅ Dashboard: read-only browse → controlled mutations (optional --dashboard flag)
- ✅ Semantic search with text-based queries
- ✅ Governance: schema version & hash lock, drift detection, mutation gating
- ✅ Input validation with AJV schemas and pre-dispatch parameter checking
- ✅ Performance: Optimized for <50ms response times

### Available Tools

- **Instructions**: `list`, `get`, `search`, `export`, `diff`, `import`, `repair`, `reload`
- **Usage Tracking**: `track`, `hotset`, `flush`
- **Governance**: `integrity/verify`, `gates/evaluate`, `prompt/review`
- **System**: `health/check`, `metrics/snapshot`, `meta/tools`

## Quick Start

1. Install dependencies: `npm ci`
2. Build: `npm run build`
3. Test: `npm test`
4. Run: `node dist/server/index.js`
5. Optional dashboard: `node dist/server/index.js --dashboard --dashboard-port=3210`

### Security & Mutation Control

- **MCP_ENABLE_MUTATION=1**: Enables write operations (import, repair, reload, flush)
- **MCP_LOG_VERBOSE=1**: Detailed logging for debugging
- Input validation prevents malformed requests
- Gated mutations require explicit environment flag

## Testing

Comprehensive test coverage including:

- MCP protocol compliance tests (`mcpProtocol.spec.ts`)
- Input validation and parameter checking
- Tool registry and schema validation
- Contract testing for API stability
- Security hardening and edge cases

Run tests: `npm test` (23 tests across 13 files)

## Architecture

- **Transport**: JSON-RPC 2.0 over stdio with metrics collection
- **Validation**: AJV-based input schema validation with fail-open fallback
- **Registry**: Centralized tool metadata with input/output schemas
- **Persistence**: File-based instruction storage with usage analytics
- **Gating**: Environment-controlled mutation access with audit logging

Hooks: Pre-commit runs typecheck, lint, tests, and security scan. Manual scan: `npm run scan:security`.

## Roadmap

See `docs/IMPLEMENTATION-PLAN.md` and `docs/ARCHITECTURE.md` for detailed planning.
