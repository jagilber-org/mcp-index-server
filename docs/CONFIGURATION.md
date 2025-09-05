# MCP Index Server Configuration Guide

This document covers all configuration options for the MCP Index Server, including environment variables and command-line arguments.

## Configuration Priority

Configuration is applied in the following order (later overrides earlier):

1. **Default values** (hardcoded)
2. **Environment variables** (runtime)
3. **Command line arguments** (highest priority)

## Dashboard Configuration

The MCP Index Server includes an optional HTTP dashboard for administrative monitoring.

### Dashboard Command Line Arguments

```bash
# Enable dashboard with defaults
node dist/server/index.js --dashboard

# Custom configuration
node dist/server/index.js \
  --dashboard \
  --dashboard-port=9000 \
  --dashboard-host=localhost \
  --dashboard-tries=5

# Disable dashboard explicitly
node dist/server/index.js --no-dashboard
```

### Dashboard Environment Variables

```bash
# Enable dashboard
export MCP_DASHBOARD=1

# Configure dashboard settings
export MCP_DASHBOARD_PORT=9000
export MCP_DASHBOARD_HOST=localhost
export MCP_DASHBOARD_TRIES=5

# Disable dashboard
export MCP_DASHBOARD=0
```

### Dashboard Reference Table

| Setting | CLI Argument | Environment Variable | Default | Description |
|---------|--------------|---------------------|---------|-------------|
| Enable | `--dashboard` / `--no-dashboard` | `MCP_DASHBOARD` | `false` | Enable HTTP dashboard |
| Port | `--dashboard-port=PORT` | `MCP_DASHBOARD_PORT` | `8787` | HTTP port for dashboard |
| Host | `--dashboard-host=HOST` | `MCP_DASHBOARD_HOST` | `127.0.0.1` | Bind address |
| Retries | `--dashboard-tries=N` | `MCP_DASHBOARD_TRIES` | `10` | Port retry attempts |

## Runtime Environment Variables

### Core Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_LOG_VERBOSE` | `0` | Enable verbose RPC/transport logging |
| `MCP_LOG_DIAG` | `0` | Enable diagnostic logging |
| `MCP_ENABLE_MUTATION` | `0` | Enable write operations (add/import/remove/etc.) |
| `MCP_IDLE_KEEPALIVE_MS` | `30000` | Keepalive interval for idle transports (ms) |

### Dashboard Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_DASHBOARD` | `0` | Enable admin dashboard (0=disable, 1=enable) |
| `MCP_DASHBOARD_PORT` | `8787` | Dashboard HTTP port |
| `MCP_DASHBOARD_HOST` | `127.0.0.1` | Dashboard bind address |
| `MCP_DASHBOARD_TRIES` | `10` | Maximum port retry attempts |

### Advanced Diagnostics

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_HANDSHAKE_TRACE` | `0` | Detailed handshake stage tracing |
| `MCP_HEALTH_MIXED_DIAG` | `0` | Mixed transport health diagnostics |
| `MCP_DISABLE_EARLY_STDIN_BUFFER` | `0` | Disable early stdin buffer |
| `MCP_DISABLE_INIT_SNIFF` | `0` | Disable initial stdout sniff logic |
| `MCP_INIT_FALLBACK_ALLOW` | `0` | Allow init fallback override path |

### Test and Development

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_STRESS_DIAG` | `0` | Enable stress testing diagnostics |
| `MCP_SHARED_SERVER_SENTINEL` | unset | Multi-client shared server mode |
| `MULTICLIENT_TRACE` | `0` | Multi-client tracing |

## Security Considerations

### Dashboard Security

* **Local Only**: Dashboard should only bind to `127.0.0.1` or `localhost`
* **Read-Only**: Dashboard provides monitoring only, no write operations
* **Process Isolation**: Dashboard runs in same process as MCP server
* **No Authentication**: Dashboard has no built-in authentication

### Production Recommendations

```bash
# Production: Disable dashboard
export MCP_DASHBOARD=0

# Production: Disable mutations
export MCP_ENABLE_MUTATION=0

# Production: Minimal logging
export MCP_LOG_VERBOSE=0
export MCP_LOG_DIAG=0
```

### Development Setup

```bash
# Development: Enable dashboard and logging
export MCP_DASHBOARD=1
export MCP_DASHBOARD_PORT=8787
export MCP_LOG_VERBOSE=1
export MCP_ENABLE_MUTATION=1
```

## Configuration Examples

### Example 1: Local Development

```bash
#!/bin/bash
# Local development with dashboard and verbose logging

export MCP_DASHBOARD=1
export MCP_DASHBOARD_PORT=8787
export MCP_LOG_VERBOSE=1
export MCP_ENABLE_MUTATION=1

node dist/server/index.js
```

### Example 2: Production Deployment

```bash
#!/bin/bash
# Production: secure and minimal

export MCP_DASHBOARD=0
export MCP_ENABLE_MUTATION=0
export MCP_LOG_VERBOSE=0

node dist/server/index.js
```

### Example 3: CLI Override

```bash
# Environment enables dashboard on port 8787
export MCP_DASHBOARD=1
export MCP_DASHBOARD_PORT=8787

# CLI overrides to port 9000
node dist/server/index.js --dashboard-port=9000
# Result: Dashboard enabled on port 9000
```

### Example 4: Docker Configuration

```dockerfile
# Dockerfile
FROM node:18-alpine

# Set environment variables
ENV MCP_DASHBOARD=1
ENV MCP_DASHBOARD_PORT=8787
ENV MCP_DASHBOARD_HOST=0.0.0.0
ENV MCP_LOG_VERBOSE=0

# Expose dashboard port
EXPOSE 8787

CMD ["node", "dist/server/index.js"]
```

## Help and Documentation

Get help with all configuration options:

```bash
node dist/server/index.js --help
```

## Troubleshooting

### Dashboard Not Starting

1. **Port in use**: Dashboard will automatically try next available port
2. **Permission denied**: Use port > 1024 for non-root users
3. **Bind address**: Ensure host address is valid

### Common Issues

```bash
# Check if dashboard is enabled
curl http://localhost:8787

# Enable dashboard with environment
export MCP_DASHBOARD=1
node dist/server/index.js

# Enable dashboard with CLI
node dist/server/index.js --dashboard
```

## Migration Notes

### From CLI-only to Environment Variables

Old approach:

```bash
node dist/server/index.js --dashboard --dashboard-port=9000
```

New approach (equivalent):

```bash
export MCP_DASHBOARD=1
export MCP_DASHBOARD_PORT=9000
node dist/server/index.js
```

CLI arguments still work and override environment variables when specified.
