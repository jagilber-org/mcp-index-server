// Lightweight in-process tool registry used exclusively by the SDK server path.
// Replaces the prior custom JSON-RPC transport layer.
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
  // Wrap with timing for metrics
  handlers[name] = (async (params: TParams) => {
    const start = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
    try {
      return await Promise.resolve(fn(params));
    } finally {
      const end = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
      const ms = Number(end - start) / 1_000_000;
      recordMetric(name, ms);
    }
  }) as Handler;
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