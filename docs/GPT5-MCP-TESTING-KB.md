# GPT-5 MCP TESTING KNOWLEDGE BASE

## 🚨 CRITICAL TESTING TOOL DEPLOYED

**LOCATION**: `/portable/` directory in workspace root
**PURPOSE**: Troubleshoot complex CRUD test failures in MCP Index Server
**STATUS**: Production-ready, tested, documented

## 🎯 IMMEDIATE ACCESS COMMANDS

```bash
# Run from workspace root
cd portable && npm run smoke          # Human-readable test
cd portable && npm run smoke:json     # Machine-readable JSON
```

## 🔍 KNOWN CRITICAL ISSUES TO INVESTIGATE

### MCP Index Server v1.0.7 CRUD Persistence Bugs

- **66.7% CRUD failure rate** with silent data loss
- **False positive responses**: Server reports success but data isn't persisted
- **Bug Reports Filed**:
  - Report ID: f8b7425a1a1f5e7d (Simple add total failure)
  - Report ID: 512f9d1f405e7aa1 (Import 50% data loss)
  - Report ID: 99ed975af4de3d19 (Batch all-or-nothing behavior)

## 🧠 TROUBLESHOOTING METHODOLOGY

1. **ALWAYS run portable smoke test FIRST** to establish MCP protocol baseline
2. **Compare results** with target server to isolate issues
3. **Document exact deviations** from portable client behavior
4. **Use JSON output** for programmatic analysis

## 📋 SUCCESS CRITERIA

Healthy MCP server should match portable client:

- ✅ 100% tool discovery success
- ✅ 100% tool invocation success  
- ✅ Consistent response formatting
- ✅ No silent failures

## 🔧 REFERENCE IMPLEMENTATION

Portable client provides:

- 3 tools: echo, math, system_info
- MCP protocol compliance validation
- Tool discovery and invocation testing
- Response format validation

## 📖 FULL DOCUMENTATION

Complete documentation: `docs/PORTABLE-MCP-TEST-CLIENT.md`
Integration in README.md documentation suite

---
**DEPLOYMENT DATE**: August 29, 2025
**PRIORITY**: CRITICAL for MCP troubleshooting
**ACCESS**: GPT-5 Knowledge Base Entry
