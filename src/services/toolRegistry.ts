/**
 * Central MCP-style tool registry.
 * Provides per-tool metadata including description, input & output JSON Schemas.
 * This enables host agents to introspect capabilities & perform client-side validation.
 */
import { schemas as outputSchemas } from '../schemas';

export interface ToolRegistryEntry {
  name: string;                 // Fully qualified method name (JSON-RPC method)
  description: string;          // Human readable summary
  stable: boolean;              // Stable across sessions (deterministic side-effect free)
  mutation: boolean;            // Performs mutation / requires MCP_ENABLE_MUTATION
  inputSchema: object;          // JSON Schema for params (always an object schema)
  outputSchema?: object;        // JSON Schema for successful result (subset of outputSchemas map)
}

// Input schema helpers (keep intentionally permissive if params optional)
const stringReq = (name: string) => ({ type: 'object', additionalProperties: false, required: [name], properties: { [name]: { type: 'string' } } });

// Explicit param schemas derived from handlers in toolHandlers.ts
const INPUT_SCHEMAS: Record<string, object> = {
  'health/check': { type: 'object', additionalProperties: true }, // no params
  'instructions/dispatch': { type: 'object', additionalProperties: true, required: ['action'], properties: { action: { type: 'string' } } },
  'instructions/governanceHash': { type: 'object', additionalProperties: true },
  'instructions/governanceUpdate': { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string' },
    owner: { type: 'string' },
    status: { type: 'string', enum: ['approved','draft','deprecated','superseded'] },
    lastReviewedAt: { type: 'string' },
    nextReviewDue: { type: 'string' },
    bump: { type: 'string', enum: ['patch','minor','major','none'] }
  } },
  // Re-expose legacy read-only query endpoints for direct invocation paths still in tests
  'instructions/query': { type: 'object', additionalProperties: true, properties: {
    categoriesAll: { type: 'array', items: { type: 'string' } },
    categoriesAny: { type: 'array', items: { type: 'string' } },
    excludeCategories: { type: 'array', items: { type: 'string' } },
    priorityMin: { type: 'number' },
    priorityMax: { type: 'number' },
    priorityTiers: { type: 'array', items: { type: 'string', enum: ['P1','P2','P3','P4'] } },
    requirements: { type: 'array', items: { type: 'string', enum: ['mandatory','critical','recommended','optional','deprecated'] } },
    text: { type: 'string' },
    limit: { type: 'number', minimum:1, maximum:1000 },
    offset: { type: 'number', minimum:0 }
  } },
  'instructions/categories': { type: 'object', additionalProperties: true },
  // legacy read-only instruction method schemas removed in favor of dispatcher
  'instructions/import': { type: 'object', additionalProperties: false, required: ['entries'], properties: {
    entries: { type: 'array', minItems: 1, items: { type: 'object', required: ['id','title','body','priority','audience','requirement'], additionalProperties: true, properties: {
      id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, rationale: { type: 'string' }, priority: { type: 'number' }, audience: { type: 'string' }, requirement: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, mode: { type: 'string' }
    } } },
    mode: { enum: ['skip','overwrite'] }
  } },
  'instructions/add': { type: 'object', additionalProperties: false, required: ['entry'], properties: {
    entry: { type: 'object', required: ['id','body'], additionalProperties: true, properties: {
      id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, rationale: { type: 'string' }, priority: { type: 'number' }, audience: { type: 'string' }, requirement: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, deprecatedBy: { type: 'string' }, riskScore: { type: 'number' }
    } },
    overwrite: { type: 'boolean' },
    lax: { type: 'boolean' }
  } },
  'instructions/repair': { type: 'object', additionalProperties: true },
  'instructions/reload': { type: 'object', additionalProperties: true },
  'instructions/remove': { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', minItems: 1, items: { type: 'string' } }, missingOk: { type: 'boolean' } } },
  'instructions/groom': { type: 'object', additionalProperties: false, properties: { mode: { type: 'object', additionalProperties: false, properties: { dryRun: { type: 'boolean' }, removeDeprecated: { type: 'boolean' }, mergeDuplicates: { type: 'boolean' }, purgeLegacyScopes: { type: 'boolean' } } } } },
  // enrichment tool (no params required)
  'instructions/enrich': { type: 'object', additionalProperties: true },
  'prompt/review': stringReq('prompt'),
  'integrity/verify': { type: 'object', additionalProperties: true },
  'feature/status': { type: 'object', additionalProperties: false, properties: {} },
  'instructions/health': { type: 'object', additionalProperties: true },
  'usage/track': stringReq('id'),
  'usage/hotset': { type: 'object', additionalProperties: false, properties: { limit: { type: 'number', minimum: 1, maximum: 100 } } },
  'usage/flush': { type: 'object', additionalProperties: true },
  'metrics/snapshot': { type: 'object', additionalProperties: true },
  'gates/evaluate': { type: 'object', additionalProperties: true },
  'meta/tools': { type: 'object', additionalProperties: true },
  // feedback system tools
  'feedback/submit': { type: 'object', additionalProperties: false, required: ['type', 'severity', 'title', 'description'], properties: {
    type: { type: 'string', enum: ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    title: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    context: { type: 'object', additionalProperties: true, properties: {
      clientInfo: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' } } },
      serverVersion: { type: 'string' },
      environment: { type: 'object', additionalProperties: true },
      sessionId: { type: 'string' },
      toolName: { type: 'string' },
      requestId: { type: 'string' }
    } },
    metadata: { type: 'object', additionalProperties: true },
    tags: { type: 'array', maxItems: 10, items: { type: 'string' } }
  } },
  'feedback/list': { type: 'object', additionalProperties: false, properties: {
    type: { type: 'string', enum: ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    status: { type: 'string', enum: ['new', 'acknowledged', 'in-progress', 'resolved', 'closed'] },
    limit: { type: 'number', minimum: 1, maximum: 200 },
    offset: { type: 'number', minimum: 0 },
    since: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  } },
  'feedback/get': { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string' }
  } },
  'feedback/update': { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['new', 'acknowledged', 'in-progress', 'resolved', 'closed'] },
    metadata: { type: 'object', additionalProperties: true }
  } },
  'feedback/stats': { type: 'object', additionalProperties: false, properties: {
    since: { type: 'string' }
  } },
  'feedback/health': { type: 'object', additionalProperties: true },
  // diagnostics / test-only tools (not stable)
  'diagnostics/block': { type: 'object', additionalProperties: false, required: ['ms'], properties: { ms: { type: 'number', minimum: 0, maximum: 10000 } } },
  'diagnostics/microtaskFlood': { type: 'object', additionalProperties: false, properties: { count: { type: 'number', minimum: 0, maximum: 200000 } } },
  'diagnostics/memoryPressure': { type: 'object', additionalProperties: false, properties: { mb: { type: 'number', minimum: 1, maximum: 512 } } }
};

// Stable & mutation classification lists (mirrors usage in toolHandlers; exported to remove duplication there).
export const STABLE = new Set(['health/check','instructions/dispatch','instructions/governanceHash','instructions/query','instructions/categories','prompt/review','integrity/verify','usage/track','usage/hotset','metrics/snapshot','gates/evaluate','meta/tools','feedback/list','feedback/get','feedback/stats','feedback/health']);
const MUTATION = new Set(['instructions/add','instructions/import','instructions/repair','instructions/reload','instructions/remove','instructions/groom','instructions/enrich','instructions/governanceUpdate','usage/flush','feedback/submit','feedback/update']);

export function getToolRegistry(): ToolRegistryEntry[] {
  const entries: ToolRegistryEntry[] = [];
  const names = new Set<string>([...STABLE, ...MUTATION]);
  // Ensure we also expose any tools that have schemas even if not in STABLE/MUTATION lists.
  for(const k of Object.keys(INPUT_SCHEMAS)) names.add(k);
  for(const name of Array.from(names).sort()){
    const outputSchema = (outputSchemas as Record<string, object>)[name];
    entries.push({
      name,
      description: describeTool(name),
      stable: STABLE.has(name),
      mutation: MUTATION.has(name),
      inputSchema: INPUT_SCHEMAS[name] || { type: 'object' },
      outputSchema
    });
  }
  return entries;
}

function describeTool(name: string): string {
  switch(name){
    case 'health/check': return 'Returns server health status & version.';
  case 'instructions/dispatch': return 'Unified dispatcher for instruction catalog actions (list,get,search,diff,export,query,categories,dir & mutations).';
  case 'instructions/governanceHash': return 'Return governance projection & deterministic governance hash.';
  case 'instructions/query': return 'Filter instruction catalog by categories, priorities, tiers, requirements, and text search.';
  case 'instructions/categories': return 'Return category taxonomy with occurrence counts.';
  // legacy read-only instruction descriptions removed (handled via dispatcher)
    case 'instructions/import': return 'Import (create/overwrite) instruction entries from provided objects.';
  case 'instructions/add': return 'Add a single instruction (lax mode fills defaults; overwrite optional).';
    case 'instructions/repair': return 'Repair out-of-sync sourceHash fields (noop if none drifted).';
  case 'instructions/reload': return 'Force reload of instruction catalog from disk.';
  case 'instructions/remove': return 'Delete one or more instruction entries by id.';
  case 'instructions/groom': return 'Groom catalog: normalize, repair hashes, merge duplicates, remove deprecated.';
  case 'instructions/enrich': return 'Persist normalization of placeholder governance fields to disk.';
  case 'instructions/governanceUpdate': return 'Patch limited governance fields (owner/status/review dates + optional version bump).';
    case 'prompt/review': return 'Static analysis of a prompt returning issues & summary.';
  case 'integrity/verify': return 'Verify each instruction body hash against stored sourceHash.';
  case 'feature/status': return 'Report active index feature flags and counters.';
    case 'usage/track': return 'Increment usage counters & timestamps for an instruction id.';
    case 'usage/hotset': return 'Return the most-used instruction entries (hot set).';
    case 'usage/flush': return 'Flush usage snapshot to persistent storage.';
    case 'metrics/snapshot': return 'Performance metrics summary for handled methods.';
  case 'instructions/health': return 'Compare live catalog to canonical snapshot for drift.';
    case 'gates/evaluate': return 'Evaluate configured gating criteria over current catalog.';
    case 'meta/tools': return 'Enumerate available tools & their metadata.';
  // feedback system descriptions
  case 'feedback/submit': return 'Submit feedback entry (issue, status report, security alert, feature request, etc.).';
  case 'feedback/list': return 'List feedback entries with filtering options (type, severity, status, date range).';
  case 'feedback/get': return 'Get specific feedback entry by ID with full details.';
  case 'feedback/update': return 'Update feedback entry status and metadata (admin function).';
  case 'feedback/stats': return 'Get feedback system statistics and metrics dashboard.';
  case 'feedback/health': return 'Health check for feedback system storage and configuration.';
  // diagnostics descriptions
  case 'diagnostics/block': return 'Intentionally CPU blocks the event loop for N ms (diagnostic stress).';
  case 'diagnostics/microtaskFlood': return 'Flood the microtask queue with many Promise resolutions to probe event loop starvation.';
  case 'diagnostics/memoryPressure': return 'Allocate & release transient memory to induce GC / memory pressure.';
  case 'diagnostics/handshake': return 'Return recent handshake events (ordering/ready/list_changed trace).';
    default: return 'Tool description pending.';
  }
}

// Registry version bumped to align with dispatcher consolidation docs regeneration (TOOLS-GENERATED.md)
export const REGISTRY_VERSION = '2025-08-27';
