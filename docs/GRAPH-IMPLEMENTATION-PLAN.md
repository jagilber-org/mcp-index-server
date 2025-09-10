# Instruction Graph Implementation Plan

Status: Draft
Branch: feature/instruction-graph-phase1
Owner: (assign)
Last Updated: 2025-09-10

## Objective

Add a deterministic, queryable in-memory graph representation of the instruction catalog to enable structural analytics, related-instruction discovery, and future recommendation/embedding layers without disrupting existing MCP tool behavior.

## Non-Goals (Phase 1)

- No external database/graph engine
- No embeddings or semantic similarity
- No real-time subscription streaming
- No governance hash gating (optional later)

## Phased Roadmap

### Phase 1 (Structural Graph MVP)

Deliverable: `graph/export` tool returning structural graph JSON (and optional DOT) derived from instruction categories.

Scope:

- Nodes: every instruction (id, primaryCategory, categories[])
- Edge Types:
  - `category` (between instructions sharing a non-primary category)
  - `primary` (between instructions sharing the same primaryCategory) OR alternative hub approach (see design decision below)
- Determinism: sorted node list, sorted edges (lexicographic source,target,type)
- Config: env toggles (e.g. `GRAPH_INCLUDE_PRIMARY_EDGES=1`), default on
- JSON Schema: `graph.export.result.schema.json` (Phase 1 only)
- Tests: determinism, empty catalog, single node, multi-category edge generation, duplicate prevention
- Docs: README section + update DOCS-INDEX + new `GRAPH.md`

Metrics (optional): nodeCount, edgeCount, buildMs

### Phase 2 (Usage & Lightweight Similarity)

Adds dynamic co-usage edges and basic category Jaccard similarity weighting.

Scope Additions:

- Edge Type: `coUsage` (instructions observed within same usage window)
- Edge Weights: normalized [0,1]
- Filtering params: `edgeTypes`, `minWeight`, `focusNode`, `limit`
- Incremental partial rebuild (add/import triggers local recalculation)
- Tests for weight determinism & filter logic

### Phase 3 (Optional Advanced Enrichment)

- Embedding-based similarity (feature-flag)
- Graph snapshot hashing & drift diff tool
- Simple connected components / centrality metrics

### Phase 4 (Enterprise Hardening)

- Governance integration (ALLOW_GRAPH_HASH_CHANGE)
- Dashboard visualization panel
- Versioned snapshots & diff export

## Design Decisions (Phase 1)

| Topic | Choice | Rationale |
|-------|--------|-----------|
| Primary category linkage | Undirected pairwise edges | Simple; small N expected; can shift to hub if dense |
| Edge identity | `${type}:${source}:${target}` sorted source<target | Fast duplicate detection, deterministic |
| Data structure | Build arrays; no adjacency map persisted externally | Minimal memory & easy serialization |
| Build trigger | Lazy on first `graph/export` call; cached with timestamp | Avoid startup penalty when unused |
| Cache invalidation | Clear on instruction add/import/overwrite operations | Ensures freshness |
| Error handling | Fails tool with structured MCP error | Aligns with existing handler patterns |

## Data Model

```ts
GraphResult {
  meta: { buildTs: string; nodeCount: number; edgeCount: number; buildMs: number; },
  nodes: Node[];
  edges: Edge[];
}
Node { id: string; primaryCategory?: string; categories: string[] }
Edge { source: string; target: string; type: 'primary' | 'category'; weight?: number }
```

## JSON Schema (outline)

- `$id`: `schemas/graph.export.result.schema.json`
- `nodes`: array with unique `id`
- `edges`: array, each edge: `source`, `target`, `type` enum, optional `weight`
- AdditionalProperties: false

## Tool Specification

Tool Name: `graph/export`

Input Params:

- `format`: enum `json|dot` (default `json`)
- `includeEdgeTypes?`: string[] (subset of supported; default all)
- `maxEdges?`: number (truncate deterministic order)

Return:

- If JSON: GraphResult
- If DOT: `{ dot: string, meta: {...} }`

## Determinism Guarantees

1. Read all instruction files -> stable sort by id
2. Build category -> sorted member list
3. Generate edges using nested loops with index ordering to avoid duplicates
4. Collect edges, stable lexicographic sort by (type,source,target)
5. Optional truncation applied after final sort

## Performance Considerations

- Complexity worst-case O(N * K^2) per dense category with K members. Mitigate via soft cap: if K > 150, skip pairwise for that category (log a warning) – Phase 1.

## Testing Matrix

| Test | Focus |
|------|-------|
| emptyCatalog | returns zero nodes/edges |
| singleNode | zero edges |
| multiCategoryPairing | correct edge counts & types |
| primaryCategoryEdgesToggle | env toggle respected |
| determinismSnapshot | repeat build identical SHA256 hash of JSON |
| largeCategoryCap | verifies skip & warning path |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Edge explosion | category size cap |
| Non-determinism | explicit sorting & stable iteration |
| Future schema change | version field in meta reserved (e.g. `graphSchemaVersion: 1`) |
| CI noise | gating deferred until stable usage pattern |

## Implementation Steps (Phase 1 Detail)

1. Create `src/graph/graphTypes.ts` (interfaces + builder contract)
2. Create `src/graph/buildGraph.ts` (core builder + caching)
3. Integrate invalidation hooks in instruction add/import handlers
4. Add tool registration in `toolRegistry` (`graph/export` handler file `handlers.graph.ts`)
5. Add JSON schema under `schemas/graph.export.result.schema.json`
6. Add unit tests `src/tests/unit/graphExport.spec.ts`
7. Docs: `GRAPH.md` + README/DOCS-INDEX updates
8. Optional: DOT exporter function
9. Commit Phase 1

## Future Extension Hooks

- Add `sources: string[]` to Edge for provenance
- Add `metrics` sub-object for aggregated centrality later
- Introduce `graph/query` for focused traversal

## Acceptance Criteria (Phase 1)

- Tool returns deterministic graph on consecutive calls (hash stable)
- Unit tests green; build & lint pass
- Documentation references tool & schema
- Safe no-op impact on existing flows when unused

## Open Questions

- Should we treat primaryCategory edges as a separate type or encode via weight? (Decided: separate type)
- Export categories for potential edge provenance? (Defer; add in Phase 2 if needed)

---
End of Plan.
