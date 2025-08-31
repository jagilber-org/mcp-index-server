import { registerHandler, getHandler } from '../server/registry';
import { instructionActions } from './handlers.instructions';
import { semanticError } from './errors';

// Dispatcher input type (loosely typed for now; validation handled by upstream schema layer soon)
interface DispatchBase { action: string }

// Batch operation type mirrors single action payload (shallow)
interface BatchOperation extends DispatchBase { [k: string]: unknown }

const mutationMethods = new Set([
  'instructions/add','instructions/import','instructions/remove','instructions/reload','instructions/groom','instructions/repair','instructions/enrich','instructions/governanceUpdate','usage/flush'
]);
function isMutationEnabled(){ return process.env.MCP_ENABLE_MUTATION === '1'; }

type DispatchParams = DispatchBase & { [k: string]: unknown };
registerHandler('instructions/dispatch', async (params: DispatchParams) => {
  const action = (params && params.action) as string;
  if(typeof action !== 'string' || !action.trim()) {
    try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write('[dispatcher] semantic_error code=-32602 reason=missing_action\n'); } catch { /* ignore */ }
    // Include reason hint so downstream fallback mappers can recover original semantic code even if wrapper strips it.
    semanticError(-32602,'Missing action',{ method:'instructions/dispatch', reason:'missing_action' });
  }

  // Capability listing
  if(action === 'capabilities'){
  try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write('[dispatcher] capabilities invoked\n'); } catch { /* ignore */ }
  return { version: process.env.npm_package_version || '0.0.0', supportedActions: Object.keys(instructionActions).concat(['add','import','remove','reload','groom','repair','enrich','governanceHash','governanceUpdate','health','inspect','dir','capabilities','batch']), mutationEnabled: isMutationEnabled() };
  }

  // Batch execution
  if(action === 'batch'){
    // Accept both 'operations' and 'ops' for flexibility / backward compatibility
    const rawOps = (params as { operations?: unknown; ops?: unknown }).operations || (params as { operations?: unknown; ops?: unknown }).ops;
    const ops: BatchOperation[] = Array.isArray(rawOps) ? rawOps.filter(o=> o && typeof o==='object') as BatchOperation[] : [];
    const results: unknown[] = [];
    for(const op of ops){
      try {
        const rHandler = getHandler('instructions/dispatch');
        if(!rHandler) throw new Error('dispatcher recursion handler missing');
        const r = await Promise.resolve(rHandler({ ...op }));
        results.push(r as unknown);
      } catch(e){
        const errObj = e as { message?: string; code?: number };
        results.push({ error: { message: errObj?.message || String(e), code: (errObj as { code?: number })?.code } });
      }
    }
    return { results };
  }

  // Map dispatcher actions to legacy mutation handlers or internal pure actions
  // Read-only internal actions
  if(Object.prototype.hasOwnProperty.call(instructionActions, action)){
    const fn = (instructionActions as Record<string, (p:unknown)=>unknown>)[action];
    // Specialized reliability wrapper for 'get': automatically attempt late materialization
    // using internal getEnhanced when initial catalog lookup fails but on-disk file exists.
    if(action === 'get'){
      const id = (params as { id?: unknown }).id;
      if(typeof id === 'string' && id.trim()){
        const base = fn({ id });
        if((base as { notFound?: boolean }).notFound){
          try {
            const enhanced = (instructionActions as unknown as { getEnhanced?: (p:{id:string})=>unknown }).getEnhanced?.({ id });
            if(enhanced && !(enhanced as { notFound?: boolean }).notFound){
              return enhanced; // lateMaterialized success
            }
          } catch { /* swallow fallback errors to preserve original semantics */ }
        }
        return base;
      }
    }
    return fn(params);
  }

  // Map selected action tokens to existing registered methods for mutation / governance
  const methodMap: Record<string,string> = {
    add: 'instructions/add', import: 'instructions/import', remove: 'instructions/remove', reload: 'instructions/reload', groom: 'instructions/groom', repair: 'instructions/repair', enrich: 'instructions/enrich', governanceHash: 'instructions/governanceHash', governanceUpdate: 'instructions/governanceUpdate', health: 'instructions/health', inspect: 'instructions/inspect', dir: 'instructions/dir'
  };
  const target = methodMap[action];
  if(!target) {
    try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[dispatcher] semantic_error code=-32601 reason=unknown_action action=${action}\n`); } catch { /* ignore */ }
    semanticError(-32601,`Unknown action: ${action}`,{ action, reason:'unknown_action' });
  }
  if(mutationMethods.has(target) && !isMutationEnabled()) {
    try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[dispatcher] semantic_error code=-32601 reason=mutation_disabled action=${action} target=${target}\n`); } catch { /* ignore */ }
    semanticError(-32601,`Mutation disabled for action '${action}'. Direct mutation tools are disabled - this dispatcher method should work. Set MCP_ENABLE_MUTATION=1 to enable all mutations.`,{ action, method: target, reason:'mutation_disabled', dispatcher: true });
  }
  const handler = getHandler(target);
  if(!handler) {
    try { if(process.env.MCP_LOG_VERBOSE==='1') process.stderr.write(`[dispatcher] semantic_error code=-32601 reason=unknown_handler action=${action} target=${target}\n`); } catch { /* ignore */ }
    semanticError(-32601,'Unknown action handler',{ action, target, reason:'unknown_handler' });
  }
  // Strip action key for downstream handler params
  const { action: _ignoredAction, ...rest } = params as Record<string, unknown>;
  // Backward-compatible convenience: allow single 'id' for remove instead of 'ids' array
  if(action==='remove' && typeof (rest as Record<string, unknown>).id === 'string' && !(rest as Record<string, unknown>).ids){
    (rest as Record<string, unknown>).ids = [ (rest as Record<string, unknown>).id as string ];
    delete (rest as Record<string, unknown>).id;
  }
  void _ignoredAction; // explicitly ignore for lint
  return handler(rest);
});
