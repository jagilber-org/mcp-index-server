# MCP Tools API Reference

Version: 0.7.0 (synchronized with package.json)

Fully consolidated in 0.4.0 (removed duplicated legacy sections). This document is the single source for tool contracts, env flags, and stability notes.

## Overview

The server exposes a set of JSON-RPC 2.0 methods ("tools") over stdio. By default it is read‑only. Mutating (write) operations are gated by an environment variable and clearly labeled.

Categories:

- Instruction Catalog: list, listScoped, get, search, diff, export, add, repair, import, reload, remove, groom
- Governance & Integrity: instructions/governanceHash, prompt/review, integrity/verify, gates/evaluate
- Usage & Metrics: usage/track, usage/hotset, usage/flush, metrics/snapshot
- Introspection: meta/tools

## Transport & Conventions

Requests: `{ "jsonrpc": "2.0", "id": <string|number>, "method": "instructions/list", "params": { ... } }`
Success:  `{ "jsonrpc": "2.0", "id": <same>, "result": { ... } }`
Errors:   JSON-RPC error object (code, message, optional data)
Timestamps: ISO 8601 UTC.
One JSON object per line on stdout; all human logs go to stderr.

Lifecycle methods supported internally: initialize, shutdown, exit (no separate docs; standard JSON-RPC semantics). A missed method returns -32601 and includes a nearby methods hint when verbose logging is enabled.

## Environment Flags

Mutation gating:

- MCP_ENABLE_MUTATION=1  (enable write tools, otherwise they return error: "Mutation disabled. Set MCP_ENABLE_MUTATION=1 to enable.")

Logging / diagnostics (stderr only):

- MCP_LOG_VERBOSE=1   (verbose general logging + implies mutation logging)
- MCP_LOG_MUTATION=1  (log only mutation tool executions)

Optional (future use / reserved):

- GOV_HASH_TRAILING_NEWLINE=1 (append trailing newline sentinel before hashing governance projection; must be consistent across producers/consumers if used)

## Mutation Tools (write)

Disabled by default unless MCP_ENABLE_MUTATION=1.

- instructions/add (single entry convenience; lax mode fills defaults)
- instructions/import
- instructions/repair (writes only when fixing hashes)
- instructions/reload (reindexes; side-effect is catalog reset)
- instructions/remove (permanently deletes entries by id)
- instructions/groom (catalog normalization, duplicate merge, deprecated cleanup, optional legacy scope purge)
- usage/flush (forces persistence write)

Rationale: Safer default for embedding in untrusted environments; explicit opt‑in for CI maintenance or local admin.

`meta/tools` exposes:

- mutationEnabled (boolean)
- Per-tool flags: { method, mutation?: true, disabled?: true, stable?: true }

## Logging Examples (PowerShell)

```powershell
$env:MCP_LOG_VERBOSE=1; node dist/server/index.js
$env:MCP_ENABLE_MUTATION=1; $env:MCP_LOG_MUTATION=1; node dist/server/index.js
```

## Tool Reference

Each method name below is a JSON-RPC method string.

### instructions/list

Params: { category?: string }
Result: { hash, count, items: [{ id, title? ... }] }
Filters by lowercase category token when provided.

### instructions/listScoped

Params: { userId?: string, workspaceId?: string, teamIds?: string[] }
Result: { hash, count, scope: "user"|"workspace"|"team"|"all", items: [...] }
Resolution order: user > workspace > team > all (audience=all entries). Returns the first non-empty match set.
Notes: Structured scope fields (workspaceId, userId, teamIds) are derived automatically from legacy category prefixes (scope:workspace:*, scope:user:*, scope:team:*). Those prefixed categories are stripped from categories to keep topical tags clean.

### instructions/get

Params: { id: string }
Result (found): { hash, item: InstructionEntry }
Result (missing): { notFound: true }

### instructions/search

Params: { q: string }
Case-insensitive substring over title + body.
Result: { hash, count, items: [...] }

### instructions/diff

Params: { clientHash?: string, known?: [{ id, sourceHash }] }
Result (up to date): { upToDate: true, hash }
Result (incremental): { hash, added: [InstructionEntry], updated: [...], removed: [id] }
Legacy fallback: { hash, changed: [InstructionEntry] }

### instructions/export

Params: { ids?: string[], metaOnly?: boolean }
Result: { hash, count, items: [...] }

### instructions/import (mutation)

### instructions/add (mutation)

Params: { entry: { id, body, title?, rationale?, priority?, audience?, requirement?, categories?, deprecatedBy?, riskScore? }, overwrite?: boolean, lax?: boolean }
Result (created): { id, hash, skipped:false, created:true, overwritten:false }
Result (overwritten): { id, hash, skipped:false, created:false, overwritten:true }
Result (skipped existing without overwrite): { id, hash, skipped:true, created:false, overwritten:false }
Result (error): { error, id }
Notes: In lax mode missing optional fields are defaulted (title=id, priority=50, audience=all, requirement=optional, categories=[]). Without lax all core fields must be present.


Params: { entries: InstructionEntryInput[], mode: "skip" | "overwrite" }
Result: { hash, imported, skipped, overwritten, total, errors: [] }
Notes: Automatically computes sourceHash; timestamps set to now.

### instructions/repair (mutation when rewriting)

Params: { clientHash?: string, known?: [{ id, sourceHash }] }
Result: Either incremental sync object (same as diff) OR { repaired, updated: [id] } when performing on-disk hash repairs.

### instructions/reload (mutation)

Params: none
Result: { reloaded: true, hash, count }
Effect: Clears in-memory cache and reloads from disk.

### instructions/remove (mutation)

Params: { ids: string[] }
Result: { removed, removedIds: string[], missing: string[], errorCount, errors: [{ id, error }] }
Notes: Permanently deletes matching instruction JSON files from disk. Missing ids are reported; operation still succeeds unless all fail. Requires MCP_ENABLE_MUTATION=1.

### instructions/groom (mutation)

Params: { mode?: { dryRun?: boolean, mergeDuplicates?: boolean, removeDeprecated?: boolean, purgeLegacyScopes?: boolean } }
Result: { previousHash, hash, scanned, repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, usagePruned, filesRewritten, purgedScopes, dryRun, notes: string[] }
Notes:

- dryRun reports planned changes without modifying files (hash remains the same).
- repairedHashes: number of entries whose stored sourceHash was corrected.
- normalizedCategories: entries whose categories were lowercased/deduped/sorted.
- duplicatesMerged: number of duplicate entry merges (non-primary members processed).
- deprecatedRemoved: number of deprecated entries physically removed (when removeDeprecated true and their deprecatedBy target exists).
- purgedScopes: legacy scope:* category tokens removed from disk when purgeLegacyScopes enabled.
- mergeDuplicates selects a primary per identical body hash (prefers earliest createdAt then lexicographically smallest id) and merges categories, priority (min), riskScore (max).
- filesRewritten counts actual JSON files updated on disk (0 in dryRun).
- usagePruned counts usage snapshot entries removed due to removed instructions.
- notes array contains lightweight action hints (e.g., would-rewrite:N in dryRun).
 
### Structured Scoping Fields

Each InstructionEntry may now include:

- workspaceId?: string
- userId?: string
- teamIds?: string[]

Derivation: If raw categories contain legacy tokens prefixed with scope:workspace:, scope:user:, or scope:team:, the classifier migrates them into structured fields and removes those tokens from categories. This keeps categories focused on topical / functional tagging while enabling precise scoping logic.

### Governance & Lifecycle Fields (0.7.0)

Each instruction now supports governance metadata:

- version (semantic) – initial default 1.0.0
- status: draft | review | approved | deprecated
- owner: responsible party (user/team slug)
- priorityTier: P1..P4 (derived from priority + requirement)
- classification: public | internal | restricted (default internal)
- lastReviewedAt / nextReviewDue – review cadence auto-derived by tier
- changeLog[] – array of { version, changedAt, summary }
- supersedes – id of instruction it replaces

Grooming / normalization auto-populates defaults on load; future versions will enforce presence at creation.

### prompt/review

### instructions/governanceHash

Params: none
Result: `{ count, governanceHash, items: GovernanceProjection[] }`

`GovernanceProjection` fields (stable, order-insensitive across files; items sorted by `id` before hashing):

```json
{ id, title, version, owner, priorityTier, nextReviewDue, semanticSummarySha256, changeLogLength }
```

Deterministic hash algorithm:

1. Load all instructions (enrichment ensures placeholders filled once on disk).
2. Sort by `id` ascending.
3. Map to projection JSON, stringify each projection.
4. Join with `\n` separators.
5. If `GOV_HASH_TRAILING_NEWLINE=1`, append a final `\n` (empty string join entry) for backward compatibility stabilization.
6. SHA-256 hex digest of the resulting UTF-8 buffer is `governanceHash`.

Invariance: Body-only edits (title & governance fields unchanged) do not alter governance hash; per-field governance edits must change it (validated by tests). Use this tool to detect governance metadata drift independent of content body churn.

Use cases:

- CI snapshot gating (reject unintended governance changes).
- Cross-process restart stability checks.
- Fast diff precursor: if governance hash unchanged, skip deeper governance audits.

Params: { prompt: string }
Result: { issues: [...], summary: { counts, highestSeverity? } }
Limits: 10KB max input; null bytes stripped.

### integrity/verify

Params: none
Result: { hash, count, issues: [{ id, expected, actual }], issueCount }

### gates/evaluate

Params: none (reads instructions/gates.json)
Result: { generatedAt, results: [{ id, passed, count, op, value, severity }], summary: { errors, warnings, total } }

### usage/track

Params: { id }
Result: { id, usageCount, lastUsedAt } | { notFound: true }

### usage/hotset

Params: { limit?: number (default 10, max 100) }
Result: { hash, count, limit, items: [{ id, usageCount, lastUsedAt }] }

### usage/flush (mutation)

Params: none
Result: { flushed: true }
Persists in-memory usage snapshot immediately.

### metrics/snapshot

Params: none
Result: { generatedAt, methods: [{ method, count, avgMs, maxMs }], features: { features: [..], counters: { .. }, env: [] } }

### feature/status

Params: none
Result: { features: [ 'usage', ... ], counters: { featureActivated:usage, propertyUpdate:usage, usage:gated }, env: ['usage', ...] }
Notes: Exposes active INDEX_FEATURES flags and internal counters. Use to verify feature gate state without side effects.

### meta/tools

Params: none
Result: Legacy + structured response:

```json
{
  tools: [ { method, stable, mutation, disabled? } ],
  stable: { tools: [ { method, stable, mutation } ] },
  dynamic: { generatedAt, mutationEnabled, disabled: [ { method } ] },
  mcp: {
  registryVersion: "2025-08-25",
    tools: [ {
      name,                // method name
      description,         // human readable summary
      stable,              // deterministic read-only
      mutation,            // requires MCP_ENABLE_MUTATION for side effects
      inputSchema,         // JSON Schema for params
      outputSchema?        // JSON Schema for result (when defined in server)
    } ]
  }
}
```

The `mcp` block is the new machine-consumable registry enabling client-side validation & discovery. Legacy fields remain for backward compatibility.

### Input Validation

The server performs pre-dispatch JSON Schema validation of `params` using the registry `inputSchema`.

Failure:

```json
{ "jsonrpc":"2.0", "id":7, "error": { "code": -32602, "message": "Invalid params", "data": { "method":"instructions/get", "errors": [ /* Ajv errors */ ] } } }
```

Guidelines:

- Omit `params` or use `{}` for methods with no required fields.
- Respect `additionalProperties:false` where specified.
- Surface `error.data.errors` for actionable diagnostics.

## Data Model

interface InstructionEntry {
  id: string;
  title: string;
  body: string;
  rationale?: string;
  priority: number; // 1 (highest)..100 (lowest)
  audience: 'individual' | 'group' | 'all';
  requirement: 'mandatory' | 'critical' | 'recommended' | 'optional' | 'deprecated';
  categories: string[]; // normalized lowercase unique
  sourceHash: string;   // sha256(body)
  schemaVersion: string;
  deprecatedBy?: string;
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
  lastUsedAt?: string;
  riskScore?: number;
  workspaceId?: string; // structured scope (derived if legacy category prefix scope:workspace:VALUE present)
  userId?: string;      // structured scope (derived if legacy category prefix scope:user:VALUE present)
  teamIds?: string[];   // structured scope (derived if legacy category prefixes scope:team:VALUE present)
}

## Persistence

Usage counts stored in data/usage-snapshot.json (debounced ~500ms + flush on shutdown signals). Force write with usage/flush.

## Error Codes

- -32601 Method not found
- -32600 Invalid Request
- -32700 Parse error
- -32603 Internal error (error.data.message contains detail)

## Security & Safety

- Read-only by default; enable mutation explicitly.
- prompt/review uses simple, bounded pattern checks (no catastrophic regex).
- integrity/verify & instructions/diff aid tamper detection.
- Logging segregated to stderr to avoid protocol corruption.

## CLI Flags

--dashboard              Enable read-only dashboard (HTML + /tools.json) (default off)
--dashboard-port=PORT    Desired dashboard port (default 8787)
--dashboard-host=HOST    Host/interface (default 127.0.0.1)
--dashboard-tries=N      Additional incremental ports to try (default 10)
--no-dashboard           Disable dashboard
-h, --help               Show help

Example: node dist/server/index.js --dashboard --dashboard-port=9000

Dashboard URL is written to stderr when available.

## VS Code Integration

Example mcp.json:

```json
{
  "servers": {
    "instructionIndex": {
      "command": "node",
      "args": ["dist/server/index.js"],
      "transport": "stdio"
    }
  }
}
```

Ensure an instructions/ directory exists before launch.

## Versioning & Stability

Stability tags (stable | experimental) surfaced via meta/tools. Any change to a stable contract triggers a semver minor (additive) or major (breaking) bump and TOOLS.md update.

Promotion roadmap (tentative):

1. instructions/list|get|search
2. prompt/review (after adding remediation/category fields)
3. diff / repair incremental contract

## Change Log

- 0.7.0: Added `instructions/governanceHash` stable tool, governance projection & deterministic hash, enrichment persistence pass, stabilization of usage tracking (atomic firstSeenTs + synchronous first flush), added governance lifecycle fields documentation, optional `GOV_HASH_TRAILING_NEWLINE` flag.

- 0.5.1: Added instructions/remove mutation tool; updated schemas, registry, docs.
- 0.6.0: Added structured scoping fields (workspaceId, userId, teamIds), new instructions/listScoped tool, groom purgeLegacyScopes + purgedScopes metric.
- 0.5.0: Migrated to official @modelcontextprotocol/sdk; added ping, server/ready notification, initialize guidance, standardized error codes/data.
- 0.4.0: Added lifecycle (initialize/shutdown/exit) handling + richer method-not-found diagnostics, consolidated docs, clarified mutation tool list, improved usage persistence & flush gating.
- 0.3.0: Introduced environment gating (MCP_ENABLE_MUTATION), logging flags (MCP_LOG_VERBOSE, MCP_LOG_MUTATION), meta/tools mutation & disabled flags.
- 0.2.0: Added integrity/verify, usage/*, metrics/snapshot, gates/evaluate, incremental diff, schemas & performance benchmark.
- 0.1.0: Initial instruction tools + prompt/review + health.

## Future (Roadmap)

- Optional checksum streaming diff endpoint for very large catalogs.
- Batched usage/track variant.
- Semantic search extension (vector index) behind feature flag.
- Policy gate expressions with logical combinators.

## Disclaimer

All experimental contracts may evolve; pin a version and validate with contract tests (npm run test:contracts) before upgrading.

