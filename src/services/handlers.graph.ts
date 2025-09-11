// Instruction Graph Export Handler
// Phase 1 minimal deterministic implementation to satisfy graphExport.spec.ts.
// Provides a structural graph representation of the current instruction catalog with:
//  - Deterministic node ordering (alphabetical by id)
//  - Two edge types: 'primary' (instruction -> primaryCategory) and 'category' (pairwise co-category)
//  - Optional exclusion of primary edges via env GRAPH_INCLUDE_PRIMARY_EDGES=0
//  - Large category pairwise edge skip with note when size exceeds GRAPH_LARGE_CATEGORY_CAP (default: no cap)
//  - includeEdgeTypes filter (applied before truncation)
//  - maxEdges truncation (stable ordering then slice)
//  - format:'dot' emits Graphviz DOT output (undirected graph)
//  - Shallow caching for default parameter calls (returns identical object reference until catalog hash changes)
//  - meta: { graphSchemaVersion:1, nodeCount, edgeCount, truncated?, notes?[] }
// NOTE: This is intentionally dependency-light; future phases can enrich node/edge metadata.

import { registerHandler } from '../server/registry';
import { ensureLoaded, computeGovernanceHash } from './catalogContext';
import type { InstructionEntry } from '../models/instruction';

interface GraphExportParams {
  includeEdgeTypes?: Array<'primary'|'category'|'belongs'>;
  maxEdges?: number;
  format?: 'json'|'dot';
  // Phase 2 enrichment (opt-in, backward compatible)
  enrich?: boolean;                // enables enriched node/edge metadata + schema v2
  includeCategoryNodes?: boolean;  // materialize explicit category:* nodes
  includeUsage?: boolean;          // attach usageCount placeholder on nodes (future integration)
}

// Legacy (schema v1) node minimal shape
interface GraphNodeV1 { id: string; }
// Enriched (schema v2) node shape (superset)
interface GraphNodeV2 extends GraphNodeV1 {
  categories?: string[];
  primaryCategory?: string;
  priority?: number;
  priorityTier?: string;
  requirement?: string;
  owner?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number; // present only when includeUsage requested
  nodeType?: 'instruction'|'category';
}
type GraphNode = GraphNodeV1 | GraphNodeV2;

interface GraphEdgeBase { from: string; to: string; type: 'primary'|'category'|'belongs'; }
interface GraphEdgeEnriched extends GraphEdgeBase { weight?: number; }
type GraphEdge = GraphEdgeBase | GraphEdgeEnriched;
interface GraphMeta { graphSchemaVersion: 1; nodeCount: number; edgeCount: number; truncated?: boolean; notes?: string[] }
interface GraphResult { meta: GraphMeta; nodes: GraphNode[]; edges: GraphEdge[]; dot?: string }

// NOTE: For enriched responses we bump schema version to 2 (only when enrich=true)
const GRAPH_SCHEMA_VERSION_V1 = 1 as const;
const GRAPH_SCHEMA_VERSION_V2 = 2 as const;

// Cache now also considers environment-dependent knobs so toggling env vars between tests
// (e.g. disabling primary edges or applying a large category cap) does not incorrectly
// reuse a prior result built under different environmental semantics.
// We keep a single-entry cache for the default param invocation (no format/includeEdgeTypes/maxEdges).
// Key = governance hash + env signature (includePrimary + largeCap numeric value)
let cachedDefault: { hash: string; env: string; result: GraphResult } | null = null; // v1 only

function getEnvBoolean(name: string, defaultTrue = true){
  const v = process.env[name];
  if(v == null) return defaultTrue;
  return ['1','true','yes','on'].includes(v.toLowerCase());
}

function buildGraph(params: GraphExportParams): GraphResult {
  const { includeEdgeTypes, maxEdges, format, enrich, includeCategoryNodes, includeUsage } = params;
  const st = ensureLoaded();
  const instructions = [...st.list].sort((a,b)=> a.id.localeCompare(b.id));
  const enriched = !!enrich;
  // Build base instruction nodes (schema-dependent)
  const nodes: GraphNode[] = instructions.map(i=> {
    if(!enriched){ return { id: i.id }; }
    const inst = i as InstructionEntry & {
      priorityTier?: string; status?: string; owner?: string; createdAt?: string; updatedAt?: string; requirement?: string;
    };
    const n: GraphNodeV2 = {
      id: i.id,
      nodeType: 'instruction',
      categories: Array.isArray(i.categories)? [...i.categories] : [],
      primaryCategory: i.primaryCategory || i.categories?.[0],
      priority: typeof i.priority==='number'? i.priority: undefined,
      priorityTier: inst.priorityTier,
      requirement: inst.requirement,
      owner: inst.owner,
      status: inst.status,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    };
    if(includeUsage) n.usageCount = 0; // placeholder (future real metrics integration)
    return n;
  });

  const includePrimary = getEnvBoolean('GRAPH_INCLUDE_PRIMARY_EDGES', true);
  const largeCapRaw = process.env.GRAPH_LARGE_CATEGORY_CAP;
  const largeCap = largeCapRaw ? parseInt(largeCapRaw,10) : Infinity;

  const edges: GraphEdge[] = [];
  const notes: string[] = [];

  // Primary edges (instruction -> pseudo-node named primaryCategory).
  // We do not currently add category nodes; tests only assert edge.type membership.
  if(includePrimary){
    for(const inst of instructions){
      const primary = inst.primaryCategory || inst.categories?.[0];
      if(primary){
        // In enriched+categoryNodes mode, primary edge points to category node id to unify references
        const toId = (enriched && includeCategoryNodes) ? `category:${primary}` : `${primary}`;
        const edge: GraphEdgeEnriched = { from: inst.id, to: toId, type:'primary' };
        if(enriched) edge.weight = 1;
        edges.push(edge);
      }
    }
  }

  // Category pairwise edges (instruction id pairs that share a category)
  // Build index of category -> instruction ids
  const catMap = new Map<string,string[]>();
  for(const inst of instructions){
    const cats = Array.isArray(inst.categories) ? inst.categories : [];
    for(const c of cats){
      const lc = c.toLowerCase();
      let arr = catMap.get(lc); if(!arr){ arr=[]; catMap.set(lc, arr); }
      arr.push(inst.id);
    }
  }
  const sortedCategories = [...catMap.keys()].sort((a,b)=> a.localeCompare(b));
  for(const cat of sortedCategories){
    const ids = catMap.get(cat)!; ids.sort((a,b)=> a.localeCompare(b));
    if(ids.length > largeCap){
      if(largeCap !== Infinity){
        notes.push(`skipped pairwise for category '${cat}' size=${ids.length} cap=${largeCap}`);
      }
      continue;
    }
    // Pairwise category edges remain for backward compatibility even when category nodes materialized
    for(let i=0;i<ids.length;i++){
      for(let j=i+1;j<ids.length;j++){
        const edge: GraphEdgeEnriched = { from: ids[i], to: ids[j], type:'category' };
        if(enriched) edge.weight = 1;
        edges.push(edge);
      }
    }
  }

  // Optional category nodes & belongs edges (enriched mode only)
  if(enriched && includeCategoryNodes){
    const allCats = sortedCategories; // already sorted
    for(const cat of allCats){
      nodes.push({ id:`category:${cat}`, nodeType:'category' } as GraphNodeV2);
    }
    // belongs edges: instruction -> category node
    for(const inst of instructions){
      const cats = Array.isArray(inst.categories)? inst.categories: [];
      for(const c of cats){
        const edge: GraphEdgeEnriched = { from: inst.id, to: `category:${c}`, type:'belongs' };
        edge.weight = 1;
        edges.push(edge);
      }
    }
  }

  // Filter edge types before truncation
  let finalEdges = edges;
  if(includeEdgeTypes && includeEdgeTypes.length){
    const allowed = new Set(includeEdgeTypes);
    finalEdges = edges.filter(e=> allowed.has(e.type));
  }

  let truncated = false;
  if(typeof maxEdges === 'number' && maxEdges >= 0 && finalEdges.length > maxEdges){
    finalEdges = finalEdges.slice(0, maxEdges);
    truncated = true;
  }

  const meta: GraphMeta = { graphSchemaVersion: (enriched? GRAPH_SCHEMA_VERSION_V2: GRAPH_SCHEMA_VERSION_V1) as 1|2, nodeCount: nodes.length, edgeCount: finalEdges.length } as GraphMeta;
  if(truncated) meta.truncated = true;
  if(notes.length) meta.notes = notes;

  const result: GraphResult = { meta, nodes, edges: finalEdges };

  if(format === 'dot'){
    // Simple undirected DOT format representation. Include all nodes (instructions + optional category nodes)
    const lines: string[] = ['graph Instructions {'];
    for(const n of nodes){ lines.push(`  "${n.id}";`); }
    for(const e of finalEdges){ lines.push(`  "${e.from}" -- "${e.to}" [label="${e.type}"];`); }
    lines.push('}');
    result.dot = lines.join('\n');
  }

  return result;
}

registerHandler<GraphExportParams>('graph/export', (params) => {
  const p: GraphExportParams = params || {};
  const cacheEligible = !p.enrich && !p.format && !p.includeEdgeTypes && (p.maxEdges === undefined);
  const st = ensureLoaded();
  const hash = st.hash || computeGovernanceHash(st.list);
  // Environment signature captures knobs that influence edge construction for default invocation.
  const envSig = `${getEnvBoolean('GRAPH_INCLUDE_PRIMARY_EDGES', true)?'P1':'P0'}:${process.env.GRAPH_LARGE_CATEGORY_CAP||'INF'}`;
  if(cacheEligible && cachedDefault && cachedDefault.hash === hash && cachedDefault.env === envSig){
    return cachedDefault.result;
  }
  const graph = buildGraph(p);
  if(cacheEligible){ cachedDefault = { hash, env: envSig, result: graph }; }
  return graph;
});

// Test-only helper (not registered as a tool) to clear cached default between suites.
// Exported with a leading double underscore to discourage production usage.
export function __resetGraphCache(){ cachedDefault = null; }
// Future phases: enrich node metadata (categories, priority, usage metrics), provenance, and export adapters.
