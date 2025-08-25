// Clean shim implementation
import { registerHandler, listRegisteredMethods, getHandler } from '../server/registry';
import { getToolRegistry, REGISTRY_VERSION, STABLE as REGISTRY_STABLE } from './toolRegistry';
import { computeGovernanceHash, projectGovernance, getCatalogState } from './catalogContext';

// Side-effect registrations from modular handlers
import './handlers.instructions';
import './handlers.metrics';
import './handlers.integrity';
import './handlers.prompt';
import './handlers.usage';
import './handlers.gates';

// Rich meta/tools implementation (stable vs dynamic)
function mutationEnabled(){ return process.env.MCP_ENABLE_MUTATION === '1'; }
registerHandler('meta/tools', () => {
  const MUTATION_ENABLED = mutationEnabled();
  const methods = listRegisteredMethods();
  const registry = getToolRegistry();
  const stableTools = new Set<string>(Array.from(REGISTRY_STABLE));
  const mutationSet = new Set(registry.filter(r => r.mutation).map(r => r.name));
  const all = methods.map(m => ({ method: m, stable: stableTools.has(m), mutation: mutationSet.has(m), disabled: mutationSet.has(m) && !MUTATION_ENABLED }));
  return {
    tools: all.map(t => ({ method: t.method, stable: t.stable, mutation: t.mutation, disabled: t.disabled })),
    stable: { tools: all.map(t => ({ method: t.method, stable: t.stable, mutation: t.mutation })) },
    dynamic: { generatedAt: new Date().toISOString(), mutationEnabled: MUTATION_ENABLED, disabled: all.filter(t => t.disabled).map(t => ({ method: t.method })) },
    mcp: { registryVersion: REGISTRY_VERSION, tools: registry.map(r => ({ name: r.name, description: r.description, stable: r.stable, mutation: r.mutation, inputSchema: r.inputSchema, outputSchema: r.outputSchema })) }
  };
});

// Alias methods (underscore variants) for back-compat
const ALIAS_MAP: Record<string,string> = {
  'health_check': 'health/check',
  'instructions_list': 'instructions/list',
  'instructions_listScoped': 'instructions/listScoped',
  'instructions_get': 'instructions/get',
  'instructions_search': 'instructions/search',
  'instructions_export': 'instructions/export',
  'instructions_diff': 'instructions/diff',
  'instructions_import': 'instructions/import',
  'instructions_add': 'instructions/add',
  'instructions_repair': 'instructions/repair',
  'instructions_reload': 'instructions/reload',
  'instructions_remove': 'instructions/remove',
  'instructions_groom': 'instructions/groom',
  'instructions_health': 'instructions/health',
  'prompt_review': 'prompt/review',
  'integrity_verify': 'integrity/verify',
  'integrity_manifest': 'integrity/manifest',
  'usage_track': 'usage/track',
  'usage_hotset': 'usage/hotset',
  'usage_flush': 'usage/flush',
  'metrics_snapshot': 'metrics/snapshot',
  'gates_evaluate': 'gates/evaluate',
  'meta_tools': 'meta/tools'
};
for(const [alias, orig] of Object.entries(ALIAS_MAP)){
  const h = getHandler(orig); if(h){ registerHandler(alias, (params: unknown) => h(params)); }
}

// Export governance helpers & catalog accessor (back-compat for tests)
export { computeGovernanceHash, projectGovernance, getCatalogState };