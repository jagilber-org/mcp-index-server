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
  'instructions/list': { type: 'object', additionalProperties: false, properties: { category: { type: 'string' } } },
  'instructions/listScoped': { type: 'object', additionalProperties: false, properties: { userId: { type: 'string' }, workspaceId: { type: 'string' }, teamIds: { type: 'array', items: { type: 'string' } } } },
  'instructions/get': stringReq('id'),
  'instructions/search': stringReq('q'),
  'instructions/export': { type: 'object', additionalProperties: false, properties: { ids: { type: 'array', items: { type: 'string' } }, metaOnly: { type: 'boolean' } } },
  'instructions/diff': { type: 'object', additionalProperties: false, properties: {
    clientHash: { type: 'string' },
    known: { type: 'array', items: { type: 'object', required: ['id','sourceHash'], additionalProperties: false, properties: { id: { type: 'string' }, sourceHash: { type: 'string' } } } }
  } },
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
  'prompt/review': stringReq('prompt'),
  'integrity/verify': { type: 'object', additionalProperties: true },
  'usage/track': stringReq('id'),
  'usage/hotset': { type: 'object', additionalProperties: false, properties: { limit: { type: 'number', minimum: 1, maximum: 100 } } },
  'usage/flush': { type: 'object', additionalProperties: true },
  'metrics/snapshot': { type: 'object', additionalProperties: true },
  'gates/evaluate': { type: 'object', additionalProperties: true },
  'meta/tools': { type: 'object', additionalProperties: true }
};

// Stable & mutation classification lists (mirrors usage in toolHandlers; exported to remove duplication there).
export const STABLE = new Set(['health/check','instructions/list','instructions/listScoped','instructions/get','instructions/search','instructions/diff','instructions/export','prompt/review','integrity/verify','usage/track','usage/hotset','metrics/snapshot','gates/evaluate','meta/tools']);
const MUTATION = new Set(['instructions/add','instructions/import','instructions/repair','instructions/reload','instructions/remove','instructions/groom','usage/flush']);

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
    case 'instructions/list': return 'List all instruction entries (optionally filtered by category).';
  case 'instructions/listScoped': return 'List instructions matching structured scope (user > workspace > team > all).';
    case 'instructions/get': return 'Fetch a single instruction entry by id.';
    case 'instructions/search': return 'Search instructions by text query across title & body.';
    case 'instructions/export': return 'Export full instruction catalog, optionally subset by ids.';
    case 'instructions/diff': return 'Incremental diff of catalog relative to client known state/hash.';
    case 'instructions/import': return 'Import (create/overwrite) instruction entries from provided objects.';
  case 'instructions/add': return 'Add a single instruction (lax mode fills defaults; overwrite optional).';
    case 'instructions/repair': return 'Repair out-of-sync sourceHash fields (noop if none drifted).';
  case 'instructions/reload': return 'Force reload of instruction catalog from disk.';
  case 'instructions/remove': return 'Delete one or more instruction entries by id.';
  case 'instructions/groom': return 'Groom catalog: normalize, repair hashes, merge duplicates, remove deprecated.';
    case 'prompt/review': return 'Static analysis of a prompt returning issues & summary.';
    case 'integrity/verify': return 'Verify each instruction body hash against stored sourceHash.';
    case 'usage/track': return 'Increment usage counters & timestamps for an instruction id.';
    case 'usage/hotset': return 'Return the most-used instruction entries (hot set).';
    case 'usage/flush': return 'Flush usage snapshot to persistent storage.';
    case 'metrics/snapshot': return 'Performance metrics summary for handled methods.';
    case 'gates/evaluate': return 'Evaluate configured gating criteria over current catalog.';
    case 'meta/tools': return 'Enumerate available tools & their metadata.';
    default: return 'Tool description pending.';
  }
}

export const REGISTRY_VERSION = '2025-08-25';
