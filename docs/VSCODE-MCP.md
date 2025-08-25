# VS Code MCP Integration

Configure a custom MCP server in VS Code (or a compatible client) by adding an entry similar to:

```jsonc
{
  "servers": {
    "instructionIndex": {
      "command": "node",
      "args": ["dist/server/index.js", "--dashboard"],
      "transport": "stdio"
    }
  }
}
```

Notes:

- Transport is stdio (newline-delimited JSON-RPC 2.0).
- The server emits a `server/ready` notification with `{ version }`.
- Dashboard (optional) is read-only and lists tool methods at `/tools.json`.
- Use `meta/tools` method for programmatic tool discovery.

Flags (pass in `args`):

| Flag | Description |
|------|-------------|
| `--dashboard` | Enable HTML dashboard + tools JSON endpoint |
| `--dashboard-port=PORT` | Preferred port (auto-increments if busy) |
| `--dashboard-host=HOST` | Bind address (default 127.0.0.1) |
| `--dashboard-tries=N` | Number of successive ports to attempt |
| `--no-dashboard` | Disable dashboard even if earlier flag provided |
| `--help` | Print help (stderr) and exit |

Security Considerations:

- Dashboard is local-only by default. Change host with caution.
- Mutation tools (`instructions/import`, `instructions/repair`) are experimental and unauthenticated; restrict execution context accordingly.

Troubleshooting:

- If no output appears, ensure you built (`npm run build`) and are executing from project root.
- Conflicting ports: the server will auto-advance; check stderr for the chosen port.

Generated schemas are in `src/schemas/index.ts`; enforce via `npm run test:contracts`.
