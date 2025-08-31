# Tracing & Diagnostics Guide

Enhanced tracing provides deterministic, low‑overhead insight into catalog CRUD, handshake, and test cross‑validation flows. This document describes the unified environment flag matrix and usage patterns introduced in v1.1.0+.

## Quick Start

Set minimal core tracing:

```powershell
$env:MCP_TRACE_LEVEL='core'
```

Enable persistent JSONL trace with rotation:

```powershell
$env:MCP_TRACE_PERSIST='1'
$env:MCP_TRACE_DIR='C:\logs\mcp-trace'
$env:MCP_TRACE_MAX_FILE_SIZE='5000000' # ~5 MB per segment
```

Filter to specific categories (comma/space/semicolon delimited):

```powershell
$env:MCP_TRACE_CATEGORIES='ensureLoaded,list,get,add,test'
```

Assign a stable session id:

```powershell
$env:MCP_TRACE_SESSION='sessionA'
```

## Trace Levels

Hierarchy (superset accumulation):

* off (0) – disabled
* core (1) – high‑level catalog + ensureLoaded events
* perf (2) – performance envelopes (load durations)
* files (3) – per‑file catalog load + disk scan entries
* verbose (4) – callsites (if MCP_TRACE_CALLSITE=1) and maximal detail

Explicit level via MCP_TRACE_LEVEL overrides convenience flags. Convenience boosting flags (applied if set):

* MCP_VISIBILITY_DIAG=1 -> at least core
* MCP_CATALOG_FILE_TRACE=1 -> at least files
* MCP_TRACE_ALL=1 -> verbose

## New Environment Flags

| Flag | Purpose | Example |
|------|---------|---------|
| MCP_TRACE_LEVEL | Explicit base level (off/core/perf/files/verbose) | core |
| MCP_TRACE_PERSIST | Enable JSONL persistent file logging (1 = on) | 1 |
| MCP_TRACE_DIR | Directory for trace files (default logs/trace) | C:\logs\mcp |
| MCP_TRACE_FILE | Explicit file path override | C:\logs\trace.jsonl |
| MCP_TRACE_MAX_FILE_SIZE | Rotate after N bytes (0=off) | 5000000 |
| MCP_TRACE_FSYNC | fsync after each write (1 = on) | 1 |
| MCP_TRACE_SESSION / MCP_TRACE_SESSION_ID | Stable session id | repro123 |
| MCP_TRACE_CATEGORIES | Inclusive filter tokens | list,get,add |
| MCP_TRACE_CALLSITE | Capture function name (1 = on) | 1 |

## Categories

Category inference derives from the label bracket content e.g. `[trace:ensureLoaded:cache-hit]` yields tokens: `trace`, `ensureLoaded`, `cache-hit`. Filtering matches any token (excluding the literal `trace` helper prefix). Example: `MCP_TRACE_CATEGORIES='ensureLoaded add'`.

## Rotation Strategy

When MCP_TRACE_MAX_FILE_SIZE > 0 the initial file (trace-TIMESTAMP.jsonl) rotates to suffix `.1`, `.2`, ... once size threshold reached. Each rotation resets byte counter; session id remains constant.

## Record Schema

```json
{
  "ts": "2025-08-31T15:22:00.000Z",
  "t": 1693495320000,
  "lvl": 2,
  "label": "[trace:ensureLoaded:cache-hit]",
  "data": {"listCount": 23, "diskCount": 23},
  "func": "ensureLoaded",
  "pid": 12345,
  "session": "repro123"
}
```

## Startup Summary

With MCP_LOG_VERBOSE=1 server stderr now includes a `[startup] trace ...` line summarizing: level, session, file, categories, maxFileSize, rotationIndex.

## Test Instrumentation

`LIST_GET_CROSS_VALIDATION` emits `[trace:test:list_get_cross_validation:summary]` with metrics: totalIds, validated, sampled, concurrency, durationMs, stressMode.

## Reproducing Multi‑Client CRUD Anomalies

1. Enable persistent tracing & categories:

```powershell
$env:MCP_TRACE_PERSIST='1'
$env:MCP_TRACE_CATEGORIES='ensureLoaded list get add test'
```

1. Run multi‑client suites (e.g., feedbackReproduction.multiClient.spec.ts)
2. Correlate events by `session` and wall clock order.

## Performance Guidance

* Prefer category filters + core/perf levels for baseline.
* Escalate to files/verbose only for short targeted repro runs.
* Use rotation + session id in CI to isolate parallel job traces.

## Future Enhancements (Backlog)

* Structured tool to aggregate JSONL traces into summarized flake analysis.
* Optional gzip post‑rotation.
* Trace ingestion endpoint for centralized diagnostics.

---
Document generated alongside tracing enhancements (v1.1.0+).
