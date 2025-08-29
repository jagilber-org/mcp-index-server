# Portable MCP Test Package

Self-contained minimal package with:

* `server.mjs` – MCP compliant server (echo, math, system_info)
* `smoke-client.mjs` – Client performing initialize, tools/list, and tool calls

## Quick Use

```bash
cd portable
npm install
npm run start:server   # (optional manual run)

# In another terminal (or just run smoke which spawns server itself)
npm run smoke          # human-readable
npm run smoke:json     # machine-readable JSON summary
```

Example JSON summary:
```json
{"toolCount":3,"tools":["echo","math","system_info"],"echo":"{\"message\":\"hello portable\",...","math":"{\"op\":\"add\",\"a\":2,\"b\":5,\"result\":7}","system":"{\"platform\":...}","ok":true}
```

## Embedding Elsewhere

Copy the entire `portable` directory into a new workspace and run `npm install`.

## VS Code MCP Config Snippet

```jsonc
{
  "servers": {
    "portable-mcp": {
      "command": "node",
      "args": ["server.mjs"],
      "type": "stdio",
      "cwd": "${workspaceFolder}/portable"
    }
  }
}
```

## License

MIT
