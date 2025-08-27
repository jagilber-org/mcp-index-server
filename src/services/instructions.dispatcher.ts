import { registerHandler, getHandler } from '../server/registry';
import { instructionActions } from './handlers.instructions';

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
  if(typeof action !== 'string' || !action.trim()) throw { code:-32602, message:'Missing action', data:{ method:'instructions/dispatch' } };

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
    return fn(params);
  }

  // Map selected action tokens to existing registered methods for mutation / governance
  const methodMap: Record<string,string> = {
    add: 'instructions/add', import: 'instructions/import', remove: 'instructions/remove', reload: 'instructions/reload', groom: 'instructions/groom', repair: 'instructions/repair', enrich: 'instructions/enrich', governanceHash: 'instructions/governanceHash', governanceUpdate: 'instructions/governanceUpdate', health: 'instructions/health', inspect: 'instructions/inspect', dir: 'instructions/dir'
  };
  const target = methodMap[action];
  if(!target) throw { code:-32601, message:`Unknown action: ${action}`, data:{ action } };
  if(mutationMethods.has(target) && !isMutationEnabled()) throw { code:-32603, message:'Mutation disabled', data:{ action, method: target } };
  const handler = getHandler(target);
  if(!handler) throw { code:-32603, message:'Internal dispatch error (handler missing)', data:{ action, target } };
  // Strip action key for downstream handler params
  const { action: _ignoredAction, ...rest } = params as Record<string, unknown>;
  void _ignoredAction; // explicitly ignore for lint
  return handler(rest);
});
