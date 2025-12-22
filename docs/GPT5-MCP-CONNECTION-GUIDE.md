# GPT-5 MCP Server Connection Guide

## Quick Start for GPT-5

**Problem:** GPT-5 can't find or connect to the mcp-index-server  
**Solution:** Use the exact server name and proper MCP syntax

## 1. Server Identification

The MCP server name is: `mcp-index-server`

**Correct GPT-5 syntax:**

```bash
@mcp-index-server health/check
```

**NOT:**

- `@mcp_mcp-index-server` (wrong format)
- `@mcp-index-server/health/check` (wrong separator)
- Direct tool calls without @ prefix

## 2. Available Tools

### Core Tools

- `health/check` - Server health status
- `instructions/dispatch` - Main instruction catalog interface  
- `metrics/snapshot` - Performance metrics
- `meta/tools` - List all available tools

### Instruction Management (via dispatcher)

```bash
@mcp-index-server instructions/dispatch action=list
@mcp-index-server instructions/dispatch action=get id=some-instruction-id
@mcp-index-server instructions/dispatch action=query query=search-terms
@mcp-index-server instructions/dispatch action=categories
```

### Feedback System

```bash
@mcp-index-server feedback/list
@mcp-index-server feedback/submit type=issue severity=medium title="Test" description="Test feedback"
@mcp-index-server feedback/stats
```

## 3. Connection Verification

**Step 1:** Check server health

```bash
@mcp-index-server health/check
```

Expected response: `{ "status": "ok", "version": "1.1.1", ... }`

**Step 2:** List available tools

```bash
@mcp-index-server meta/tools
```

**Step 3:** Test instruction catalog

```bash
@mcp-index-server instructions/dispatch action=list
```

## 4. Common Connection Issues

### Issue: "Server not found"

**Cause:** Wrong server name or server not running  
**Solution:**

1. Verify exact name: `mcp-index-server` (no underscores)
2. Check VS Code MCP extension is active
3. Restart VS Code if needed

### Issue: "Method not found"

**Cause:** Using old direct method calls  
**Solution:** Use `tools/call` pattern via @ syntax

- ✅ `@mcp-index-server health/check`  
- ❌ Direct JSON-RPC `{"method":"health/check"}`

### Issue: "No response"

**Cause:** Server process not running  
**Solution:** Check VS Code MCP server status in bottom bar

## 5. Sample Workflows

### Browse Instructions

```bash
# List all instructions
@mcp-index-server instructions/dispatch action=list

# Search for specific content  
@mcp-index-server instructions/dispatch action=query query=typescript

# Get specific instruction
@mcp-index-server instructions/dispatch action=get id=found-instruction-id
```

### Submit Feedback

```bash
@mcp-index-server feedback/submit type=feature-request severity=low title="New Feature" description="Detailed description here"
```

### Monitor Server

```bash
@mcp-index-server health/check
@mcp-index-server metrics/snapshot  
@mcp-index-server feedback/stats
```

## 6. Environment Context

The server is configured with:

- Instructions directory: `C:/github/jagilber/mcp-index-server/devinstructions`
- Feedback directory: `C:/github/jagilber/mcp-index-server/feedback`  
- Mutations enabled: Yes (`MCP_ENABLE_MUTATION=1`)
- Always reload: Yes (dev mode)

## 7. Troubleshooting Commands

If GPT-5 still can't connect:

1. **Verify server name:**

   ```bash
   @mcp-index-server meta/tools
   ```

2. **Check if server responds:**

   ```bash
   @mcp-index-server health/check  
   ```

3. **List what's available:**

   ```bash
   @mcp-index-server instructions/dispatch action=list limit=5
   ```

4. **Test feedback system:**

   ```bash
   @mcp-index-server feedback/health
   ```

## 8. Expected Server Responses

### Healthy Response Pattern

```json
{
  "status": "ok",
  "version": "1.1.1", 
  "pid": 12345,
  "uptimeSeconds": 123,
  "instructions": {
    "cachedCount": 25,
    "dir": "C:/github/jagilber/mcp-index-server/devinstructions"
  }
}
```

### Tool List Pattern

Array of objects with:

- `name`: Tool identifier (e.g., "health/check")
- `description`: Human readable summary
- `stable`: Boolean indicating stability
- `mutation`: Boolean indicating if it modifies state

---

**Key Point for GPT-5:** Always use `@mcp-index-server` prefix, never direct method calls. The server only responds to MCP protocol `tools/call` requests through the @ syntax.
