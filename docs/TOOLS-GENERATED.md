# Generated Tool Registry (Dispatcher Consolidated)

Registry Version: 2025-08-27 (post-0.9.1 stabilization)

This file summarizes the current tool registry after 0.9.x dispatcher consolidation & test stabilization. Legacy per-method instruction tools (`instructions/list`, `instructions/get`, `instructions/diff`, etc.) were removed in favor of `instructions/dispatch` with an `action` discriminator.

| Method | Stable | Mutation | Description |
|--------|--------|----------|-------------|
| health/check | yes |  | Returns server health status & version. |
| instructions/dispatch | yes |  | Unified dispatcher for instruction catalog actions (list,listScoped,get,search,diff,export,query,categories,dir,capabilities,batch,inspect,governanceHash + mutations). |
| instructions/governanceHash | yes |  | Return governance projection & deterministic governance hash. |
| instructions/add |  | yes | Add a single instruction (lax mode fills defaults; overwrite optional). |
| instructions/import |  | yes | Import (create/overwrite) instruction entries from provided objects. |
| instructions/remove |  | yes | Delete one or more instruction entries by id. |
| instructions/reload |  | yes | Force reload of instruction catalog from disk. |
| instructions/groom |  | yes | Groom catalog: normalize, repair hashes, merge duplicates, remove deprecated. |
| instructions/repair |  | yes | Repair out-of-sync sourceHash fields (noop if none drifted). |
| instructions/enrich |  | yes | Persist normalization of placeholder governance fields to disk. |
| instructions/governanceUpdate |  | yes | Patch limited governance fields (owner/status/review dates + optional version bump). |
| integrity/verify | yes |  | Verify each instruction body hash against stored sourceHash. |
| prompt/review | yes |  | Static analysis of a prompt returning issues & summary. |
| gates/evaluate | yes |  | Evaluate configured gating criteria over current catalog. |
| usage/track | yes |  | Increment usage counters & timestamps for an instruction id. |
| usage/hotset | yes |  | Return the most-used instruction entries (hot set). |
| usage/flush |  | yes | Flush usage snapshot to persistent storage. |
| metrics/snapshot | yes |  | Performance metrics summary for handled methods. |
| meta/tools | yes |  | Enumerate available tools & their metadata. |

## Dispatcher Schema (Aggregate)

`instructions/dispatch` returns varied shapes depending on `action`:

- capabilities: `{ version, supportedActions, mutationEnabled }`
- batch: `{ results: [ ... per-op results ... ] }`
- list / listScoped / search / export / diff: objects containing `hash` and action-specific fields
- governanceHash (when accessed as action): `{ count, governanceHash, items? }`
- error: `{ error: string, ... }`

Loosely validated via `schemas/index.ts` (anyOf). Clients branch on requested `action` & presence of discriminators (`supportedActions`, `results`, `hash`, `error`).

## Mutation Gating

Dispatcher mutation actions (`add`, `import`, `remove`, `reload`, `groom`, `repair`, `enrich`, `governanceUpdate`) require `MCP_ENABLE_MUTATION=1`.

## Regeneration

Manual refresh process:

1. Build: `npm run build`.
2. Launch server; call `meta/tools`.
3. Verify table matches tool registry output.
4. Update Registry Version date if changed.

## 0.9.0 Notes

- Consolidated read-only instruction API surface.
- Added actions: capabilities, batch, enrich, governanceUpdate.
- Removed legacy per-method read instruction tools from registry & docs.

---
End of generated registry summary.
