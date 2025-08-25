// Lightweight in-process tool registry used exclusively by the SDK server path.
// Replaces the prior custom JSON-RPC transport layer.
import { log, newCorrelationId } from '../services/logger';
export type Handler<TParams=unknown> = (params: TParams) => Promise<unknown> | unknown;

interface MetricRecord { count: number; totalMs: number; maxMs: number }
const handlers: Record<string, Handler> = {};
const metrics: Record<string, MetricRecord> = {};

function recordMetric(name: string, ms: number){
  let rec = metrics[name];
  if(!rec){ rec = { count:0, totalMs:0, maxMs:0 }; metrics[name] = rec; }
  rec.count++; rec.totalMs += ms; if(ms > rec.maxMs) rec.maxMs = ms;
}

export function registerHandler<TParams=unknown>(name: string, fn: Handler<TParams>){
  const ENABLE = process.env.MCP_LOG_TOOLS === '1';
  const wrapped: Handler<TParams> = async (params: TParams) => {
    const corr = ENABLE ? newCorrelationId() : undefined;
    const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
    if(ENABLE){
      try { log('info','tool_start',{ tool: name, correlationId: corr }); } catch { /* logging should not break */ }
    }
    try {
      const result = await Promise.resolve(fn(params));
      return result;
    } catch(e){
      if(ENABLE){
        try { log('error','tool_error',{ tool: name, correlationId: corr, data: { message: e instanceof Error ? e.message : String(e) } }); } catch { /* ignore */ }
      }
      throw e;
    } finally {
      const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
      const ms = Number(endNs - startNs)/1_000_000;
      recordMetric(name, ms);
      if(ENABLE){
        try { log('info','tool_end',{ tool: name, correlationId: corr, ms }); } catch { /* ignore */ }
      }
    }
  };
  handlers[name] = wrapped as Handler;
}

export function getHandler(name: string){
  return handlers[name];
}

export function listRegisteredMethods(){
  return Object.keys(handlers).sort();
}

export function getMetricsRaw(){
  return metrics;
}