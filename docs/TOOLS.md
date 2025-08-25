# MCP Tools API Reference

Version: 0.2.0 (increment when stable response contracts change)

## Conventions

- Transport: JSON-RPC 2.0 over stdio (one JSON object per line)
- Request shape: `{ "jsonrpc": "2.0", "id": <string|number>, "method": "<tool>", "params": { ... } }`
- Success response: `{ "jsonrpc": "2.0", "id": <same>, "result": { ... } }`
- Error response: JSON-RPC error object with `code`, `message`, optional `data`.
- All timestamps: ISO 8601 UTC.

## Health

### Method: `health/check`

Params: none

Result:

```json
{ "status": "ok", "timestamp": "2025-01-01T00:00:00.000Z", "version": "0.1.0" }
```

## Instruction Index Tools

These operate on the loaded in-memory catalog (lazy-loaded on first request from `./instructions`).

### `instructions/list`

Params: `{ category?: string }`

Result:

```json
{
  "hash": "<aggregate-hash>",
  "count": 12,
  "items": [ { "id": "..." } ]
}
```

Notes:

- If `category` provided (case-insensitive) filters by category token.
- Future: pagination & projection fields.

### `instructions/get`

Params: `{ id: string }`

Result (found): `{ hash: string, item: InstructionEntry }`

Result (not found): `{ notFound: true }`

Notes: `hash` omitted on notFound? (Currently omitted. Future contract will include hash consistently.)

### `instructions/search`

Params: `{ q: string }` (substring match over lowercased title and body)

Result:

```json
{ "hash": "<aggregate-hash>", "count": 2, "items": [ { "id": "..." } ] }
```

Notes:

- Simple case-insensitive substring search. Future: tokenization / semantic search.

### `instructions/diff`

Purpose: Client incremental sync vs catalog hash.

Params (current incremental form):

```json
{ "clientHash": "<optional aggregate>", "known": [ { "id": "...", "sourceHash": "..." } ] }
```

Behavior:

- If `known` omitted and `clientHash` matches server hash => `{ upToDate: true, hash }`.
- If `known` provided: server returns precise changes:

```json
{ "hash": "...", "added": [ InstructionEntry ], "updated": [ InstructionEntry ], "removed": [ "id" ] }
```

- Legacy fallback: when only `clientHash` differs and no `known`, returns `{ hash, changed: InstructionEntry[] }`.

Notes:

- `sourceHash` equals `sha256(body)`; treat as content fingerprint.
- Send only a subset of known entries (e.g., recently used) for partial sync; absent IDs returned as added.
- Future: separate lightweight metadata structure vs full entries for large bodies.

## Prompt Governance

### `prompt/review`

Evaluates a prompt string against rule criteria in `docs/PROMPT-CRITERIA.json`.

Params: `{ prompt: string }`

Result:

```json
{
  "issues": [
    {
      "ruleId": "no-secrets",
      "severity": "critical",
      "description": "Potential embedded secret",
      "match": "AKIA..."
    }
  ],
  "summary": {
    "counts": { "critical": 1 },
    "highestSeverity": "critical"
  }
}
```

Future Enhancements:

- Add `category` to each issue (surface originating category id)
- Add remediation guidance text in criteria file.

## Data Model: InstructionEntry

```ts
interface InstructionEntry {
  id: string;
  title: string;
  body: string;
  rationale?: string;
  priority: number;              // 1 (highest) .. 100 (lowest)
  audience: 'individual'|'group'|'all';
  requirement: 'mandatory'|'critical'|'recommended'|'optional'|'deprecated';
  categories: string[];          // normalized to lowercase sorted unique
  sourceHash: string;            // sha256(body) at load time
  schemaVersion: string;
  deprecatedBy?: string;
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  usageCount?: number;           // planned: increment via usage tracking service
  lastUsedAt?: string;           // planned
  riskScore?: number;            // derived risk metric
}
```

## Versioning & Stability

Stability Levels:

- experimental: subject to change without notice (current tools)
- stable: contract locked & versioned via semver + schema

Planned Promotion Order:

1. health/check (stable soon)
2. instructions/list|get|search
3. instructions/diff (after incremental design)
4. prompt/review (after adding category & remediation fields)

## Error Handling

Standard JSON-RPC error codes used:

- -32601 Method not found
- -32600 Invalid Request
- -32700 Parse error
- -32603 Internal error (with `{ message }` in `error.data`)

## Additional Tools

### `integrity/verify`

Recomputes `sha256(body)` for each entry comparing against stored `sourceHash`.

Result:

```json
{ "hash": "<aggregate>", "count": 42, "issues": [ { "id": "...", "expected": "...", "actual": "..." } ], "issueCount": 0 }
```

Non-zero `issueCount` indicates catalog drift / tampering.

### `usage/track`

Increments in-memory usage counters for an instruction.

Params: `{ id: string }`

Result: `{ id, usageCount, lastUsedAt }` or `{ notFound: true }`.

### `usage/hotset`

Returns high-usage items ranked by `usageCount` then `lastUsedAt`.

Params: `{ limit?: number }` (default 10, max 100)

Result:

```json
{ "hash": "...", "count": 3, "limit": 10, "items": [ { "id": "...", "usageCount": 5, "lastUsedAt": "..." } ] }
```

### `metrics/snapshot`

Returns per-method invocation metrics accumulated since process start.

Params: none

Result:

```json
{
  "generatedAt": "2025-08-24T00:00:00.000Z",
  "methods": [
    { "method": "instructions/list", "count": 12, "avgMs": 1.3, "maxMs": 5 }
  ]
}
```

### `gates/evaluate`

Evaluates policy gates defined in `instructions/gates.json` with count-based conditions.

Result:

```json
{
  "generatedAt": "2025-08-24T00:00:00.000Z",
  "results": [
    { "id": "min-alpha", "passed": true, "count": 1, "op": ">=", "value": 1, "severity": "error" }
  ],
  "summary": { "errors": 0, "warnings": 0, "total": 2 }
}
```

## Planned Tools (Roadmap)

- integrity/reportDrifts -> incremental diff object (now partially covered by `instructions/diff` with `known` list)
- usage/track -> side-effect increment (may be batched client-side)
- metrics/snapshot -> counters & latencies
- gates/evaluate -> evaluation report using `instructions/gates.json`

## Security Considerations

- No mutation tools exposed yet; server is read-only aside from in-memory plan for future usage tracking.
- Prompt review avoids executing regex with catastrophic backtracking; criteria file kept simple.
- `prompt/review` enforces a 10KB maximum input length and strips null bytes prior to evaluation.

## Compatibility Notes

- Designed to be embedded as a subprocess MCP server.
- Line-delimited JSON; no framing beyond newline.

## Performance Benchmarking

Run `npm run perf` to execute a synthetic search benchmark over catalogs of sizes 100/1000/5000 producing JSON with P95 and max search times.

---

## Schemas

Formal JSON Schemas for each tool response live in `src/schemas/index.ts` and are enforced by `npm run test:contracts`.
Any change to a stable schema requires a semver minor (additive) or major (breaking) bump and TOOLS.md version update.

Change Log:

- 0.1.0: Initial doc covering existing four instruction tools + prompt/review + health.
- 0.2.0: Added integrity/verify, usage/*, metrics/snapshot, gates/evaluate, incremental diff, security hardening, performance benchmark, schema contracts.
