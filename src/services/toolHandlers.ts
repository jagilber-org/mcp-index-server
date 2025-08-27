// Clean shim implementation
import { registerHandler, listRegisteredMethods } from '../server/registry';
import { getToolRegistry, REGISTRY_VERSION, STABLE as REGISTRY_STABLE } from './toolRegistry';
import { computeGovernanceHash, projectGovernance, getCatalogState } from './catalogContext';

// Side-effect registrations from modular handlers
import './handlers.instructions';
import './instructions.dispatcher'; // ensure dispatcher registered regardless of server entrypoint
import './handlers.metrics';
import './handlers.integrity';
import './handlers.prompt';
import './handlers.usage';
import './handlers.gates';
import './handlers.testPrimitive'; // test helper primitive handler registration

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

// Back-compat alias map removed in 1.0.0 (BREAKING CHANGE): callers must use canonical tool names.

// Export governance helpers & catalog accessor (back-compat for tests)
export { computeGovernanceHash, projectGovernance, getCatalogState };