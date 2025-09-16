// Lightweight in-process tool registry used exclusively by the SDK server path.
// Replaces the prior custom JSON-RPC transport layer.
import { log, newCorrelationId } from '../services/logger';
import { wrapResponse } from '../services/responseEnvelope';
// Dashboard metrics integration: bridge per-tool execution to global MetricsCollector
// so the admin panel performance & tool counters reflect live activity. Previously the
// dashboard showed zeros because recordToolCall was never invoked along the runtime path.
import { getMetricsCollector } from '../dashboard/server/MetricsCollector.js';
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
  // Always log tool lifecycle events (previously gated by MCP_LOG_TOOLS)
  // Lazily resolve singleton (avoid throwing if dashboard disabled – metrics collector module
  // still exports a singleton even when dashboard not started).
  const collector = (()=>{ try { return getMetricsCollector(); } catch { return null; } })();
  const wrapped: Handler<TParams> = async (params: TParams) => {
  const corr = newCorrelationId();
    const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
    const timingEnabled = process.env.MCP_ADD_TIMING === '1';
    let phaseMarks: { p:string; t:number }[] | undefined;
    if(timingEnabled){ phaseMarks = [{ p:'start', t: Date.now() }]; }
    try { log('info','tool_start',{ tool: name, correlationId: corr }); } catch { /* logging should not break */ }
    let success = false;
    let errorType: string | undefined;
    try {
      const result = await Promise.resolve(fn(params));
      if(timingEnabled && phaseMarks){ phaseMarks.push({ p:'afterFn', t: Date.now() }); }
      success = true;
      const wrappedResp = wrapResponse(result) as { result?: unknown };
      if(timingEnabled){
        try {
          const endTs = Date.now();
          phaseMarks!.push({ p:'endPreWrap', t:endTs });
          const phases = phaseMarks!;
          (wrappedResp as Record<string, unknown>).__timing = { tool:name, phases };
        } catch { /* ignore timing embed errors */ }
      }
      return wrappedResp;
    } catch(e){
      try { log('error','tool_error',{ tool: name, correlationId: corr, data: { message: e instanceof Error ? e.message : String(e) } }); } catch { /* ignore */ }
      // Best-effort classification for dashboard error breakdown
      try {
        const errObj: unknown = e;
        // Narrow progressively without casting to any to satisfy eslint no-explicit-any rule.
        if(typeof errObj === 'object' && errObj !== null){
          const maybeCode = (errObj as { code?: unknown }).code;
          if(Number.isSafeInteger(maybeCode)) {
            errorType = `code_${maybeCode as number}`;
          } else {
            const maybeData = (errObj as { data?: unknown }).data;
            if(typeof maybeData === 'object' && maybeData !== null && typeof (maybeData as { reason?: unknown }).reason === 'string') {
              errorType = String((maybeData as { reason?: unknown }).reason);
            } else if(typeof (errObj as { reason?: unknown }).reason === 'string') {
              errorType = String((errObj as { reason?: unknown }).reason);
            } else {
              errorType = 'error';
            }
          }
        } else {
          errorType = 'error';
        }
      } catch { /* ignore classification errors */ }
      throw e;
    } finally {
      const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
      const ms = Number(endNs - startNs)/1_000_000;
      recordMetric(name, ms);
      if(timingEnabled && phaseMarks){
        try { phaseMarks.push({ p:'finally', t: Date.now() }); } catch { /* ignore */ }
      }
      // Feed global dashboard metrics (safe no-op if collector absent). This enables:
      //  - requestsPerMinute (rolling window)
      //  - successRate / errorRate
      //  - per-tool call counts & avg response time
      try { collector?.recordToolCall(name, success, ms, success ? undefined : errorType); } catch { /* never block tool path */ }
      try { log('info','tool_end',{ tool: name, correlationId: corr, ms }); } catch { /* ignore */ }
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