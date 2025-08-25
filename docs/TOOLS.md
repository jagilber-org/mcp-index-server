# MCP Tools API Reference

Version: 0.1.0 (increment when response contracts change)

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

Params: `{ clientHash?: string }`

Result Cases:

1. Up-to-date: `{ upToDate: true, hash }`
2. Not provided: `{ upToDate: false, hash }` (client should fetch catalog)
3. Drift: `{ changed: InstructionEntry[], hash }` (naive: returns full list now)

Planned Evolution:

- Contract migration to `{ added: IDSummary[], updated: IDSummary[], removed: string[], hash }`
- Provide per-item `contentHash` instead of full body for unchanged metadata diff.

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

## Planned Tools (Roadmap)

- integrity/verify -> `{ summary, issues[] }`
- integrity/reportDrifts -> incremental diff object
- usage/track -> side-effect increment (may be batched client-side)
- metrics/snapshot -> counters & latencies
- gates/evaluate -> evaluation report using `instructions/gates.json`

## Security Considerations

- No mutation tools exposed yet; server is read-only aside from in-memory plan for future usage tracking.
- Prompt review avoids executing regex with catastrophic backtracking; criteria file kept simple.

## Compatibility Notes

- Designed to be embedded as a subprocess MCP server.
- Line-delimited JSON; no framing beyond newline.

---

Change Log:

- 0.1.0: Initial doc covering existing four instruction tools + prompt/review + health.
