/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SDK-based MCP server bootstrap (dynamic require variant to work under CommonJS build).
 * Uses the published dist/ subpath exports without relying on TS ESM moduleResolution.
 */
import fs from 'fs';
import path from 'path';
import { getToolRegistry } from '../services/toolRegistry';
import '../services/toolHandlers';
import { getHandler, listRegisteredMethods } from './registry';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { z } from 'zod';

// ESM dynamic import used below for SDK modules.
// Use export map subpaths (do NOT prefix with dist/ or it will duplicate to dist/dist/...)
// We'll lazy-load ESM exports via dynamic import when starting.
let StdioServerTransport: any;
// Helper to perform a true dynamic ESM import that TypeScript won't down-level to require()
const dynamicImport = (specifier: string) => (Function('m', 'return import(m);'))(specifier);

// Bridge existing registry into SDK tool definitions
export function createSdkServer(ServerClass: any) {
  // Derive version from package.json
  let version = '0.0.0-sdk';
  try {
    const pkgPath = path.join(process.cwd(),'package.json');
    if(fs.existsSync(pkgPath)){
      const raw = JSON.parse(fs.readFileSync(pkgPath,'utf8')); if(raw.version) version = raw.version + '-sdk';
    }
  } catch { /* ignore */ }
  const server: any = new ServerClass({ name: 'mcp-index-server', version }, { capabilities: { tools: { listChanged: true } }});

  // Provide post-initialization notifications + instructions injection
  server.oninitialized = () => {
    queueMicrotask(() => {
      try {
        server.sendNotification({ method: 'server/ready', params: { version } });
        server.sendToolListChanged();
      } catch { /* ignore */ }
    });
  };

  // Helper to build a minimal zod schema for a JSON-RPC request with given method
  const requestSchema = (methodName: string) => z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.literal(methodName),
    params: z.any().optional()
  });

  // Raw handler for tools/list
  server.setRequestHandler(requestSchema('tools/list'), async () => {
    const registry = getToolRegistry();
    return { tools: registry.map(r => ({ name: r.name, description: r.description, inputSchema: r.inputSchema as Record<string,unknown> })) };
  });

  // Raw handler for tools/call (MCP style) - returns content array
  server.setRequestHandler(requestSchema('tools/call'), async (req: { params?: { name?: string; arguments?: Record<string, unknown> } }) => {
    const p = req?.params ?? {};
    const name = p.name ?? '';
    const args = p.arguments || {};
    const handler = getHandler(name);
    if(!handler){
  // Throw plain JSON-RPC style error object so SDK preserves data
  throw { code: -32603, message: `Unknown tool: ${name}`, data: { message: `Unknown tool: ${name}`, method: name } };
    }
    try {
      const result = await Promise.resolve(handler(args));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch(e){
      const msg = e instanceof Error ? e.message : String(e);
  throw { code: -32603, message: 'Tool execution failed', data: { message: msg, method: name } };
    }
  });

  // ---------------------------------------------------------------------------
  // Direct method handlers for each registered tool (back-compat with tests)
  // Implements lightweight input validation using Ajv schemas from registry.
  // ---------------------------------------------------------------------------
  const ajv = new Ajv({ allErrors: true, strict: false });
  try { addFormats(ajv); } catch (e) { /* ignore format registration errors */ }
  try {
    if(!ajv.getSchema('https://json-schema.org/draft-07/schema')) ajv.addMetaSchema(draft7MetaSchema, 'https://json-schema.org/draft-07/schema');
  } catch (e) { /* ignore meta-schema registration errors */ }
  const validators: Record<string, any> = {};
  const registry = getToolRegistry();
  for(const entry of registry){
    try { validators[entry.name] = ajv.compile(entry.inputSchema); } catch { /* ignore compile error */ }
  }

  for(const entry of registry){
    const method = entry.name;
    // Skip if we already set a handler with same name (initialize/tools/* already defined)
    if(['initialize','tools/list','tools/call'].includes(method)) continue;
    server.setRequestHandler(requestSchema(method), async (req: { params?: Record<string, unknown> }) => {
      const params = (req?.params ?? {}) as Record<string, unknown>;
      const validate = validators[method];
      if(validate){
        const ok = validate(params);
        if(!ok){
          throw { code: -32602, message: 'Invalid params', data: { method, errors: validate.errors } };
        }
      }
      const handler = getHandler(method);
      if(!handler){
        throw { code: -32601, message: 'Method not found', data: { method } };
      }
      try {
        return await Promise.resolve(handler(params));
      } catch(e){
        if(e && typeof e === 'object'){
          const anyE: any = e;
            const dataObj = (typeof anyE.data === 'object' && anyE.data) ? anyE.data : {};
            const msg = typeof anyE.message === 'string' ? anyE.message : (typeof dataObj.message === 'string' ? dataObj.message : String(e));
            const code = Number.isSafeInteger(anyE.code) ? anyE.code : -32603;
            return Promise.reject({ code, message: msg, data: { ...dataObj, method, message: msg } });
        }
        const msg = String(e);
        throw { code: -32603, message: msg, data: { method, message: msg } };
      }
    });
  }

  // Register any additional handlers that were registered via registerHandler but
  // are not present in the tool registry metadata (test-only or internal tools).
  // This ensures direct JSON-RPC method invocation still works and applies
  // centralized wrapping (metrics + feature flags) for primitives like test/primitive.
  try {
    const known = new Set(registry.map(r => r.name));
    const already = new Set<string>(['initialize','tools/list','tools/call','ping']);
    for(const name of listRegisteredMethods()){
      if(known.has(name) || already.has(name)) continue;
      server.setRequestHandler(requestSchema(name), async (req: { params?: Record<string, unknown> }) => {
        const params = (req?.params ?? {}) as Record<string, unknown>;
        const handler = getHandler(name);
        if(!handler){
          throw { code: -32601, message: 'Method not found', data: { method: name } };
        }
        return await Promise.resolve(handler(params));
      });
    }
  } catch { /* ignore dynamic registration issues */ }

  // Lightweight ping handler (simple reachability / latency measurement)
  server.setRequestHandler(requestSchema('ping'), async () => {
    return { timestamp: new Date().toISOString(), uptimeMs: Math.round(process.uptime() * 1000) };
  });

  // Patch initialize result to echo requested protocolVersion & add instructions (mirrors startSdkServer runtime patch)
  const originalInit = (server as any)._oninitialize?.bind(server);
  if(originalInit && !(server as any).__initEchoPatched){
    (server as any).__initEchoPatched = true;
    (server as any)._oninitialize = async function(request: any){
      const result = await originalInit(request);
      try {
        if(request?.params?.protocolVersion){
          (result as any).protocolVersion = request.params.protocolVersion;
        }
        if(result && typeof result === 'object' && !('instructions' in result)){
          (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.';
        }
      } catch { /* ignore */ }
      return result;
    };
  }

  return server;
}

export async function startSdkServer() {
  // Lazy dynamic import once
  if(!StdioServerTransport){
    const modServer: any = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
    const modStdio: any = await dynamicImport('@modelcontextprotocol/sdk/server/stdio.js');
    StdioServerTransport = modStdio.StdioServerTransport;
    const server = createSdkServer(modServer.Server);
    // Instance-level override of _onrequest to retain error.data
    const originalOnRequest = (server as any)._onrequest?.bind(server);
    if(originalOnRequest){
      (server as any)._onrequest = function(request: any){
        const handler = (this as any)._requestHandlers.get(request.method) ?? (this as any).fallbackRequestHandler;
        if(handler === undefined){
          return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: -32601, message:'Method not found', data:{ method: request.method } }}).catch(()=>{});
        }
        const abortController = new AbortController();
        (this as any)._requestHandlerAbortControllers.set(request.id, abortController);
        Promise.resolve()
          .then(()=> handler(request, { signal: abortController.signal }))
          .then((result:any)=>{
            if(abortController.signal.aborted) return;
            return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, result });
          }, (error:any)=>{
            if(abortController.signal.aborted) return;
            return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: Number.isSafeInteger(error?.code)? error.code: -32603, message: error?.message || 'Internal error', data: error?.data } });
          })
          .catch(()=>{})
          .finally(()=>{ (this as any)._requestHandlerAbortControllers.delete(request.id); });
      };
    }
  // Derive version again for notification (mirrors createSdkServer logic but without -sdk suffix)
  let baseVersion = '0.0.0';
  try { const pkgPath = path.join(process.cwd(),'package.json'); if(fs.existsSync(pkgPath)){ const raw = JSON.parse(fs.readFileSync(pkgPath,'utf8')); if(raw.version) baseVersion = raw.version; } } catch { /* ignore */ }
    const transport = new StdioServerTransport();
  await server.connect(transport);
  try { server.sendNotification({ method: 'server/ready', params: { version: baseVersion } }); } catch { /* ignore */ }
  try { process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'server/ready', params:{ version: baseVersion } })+'\n'); } catch { /* ignore */ }
    // Patch initialize result for instructions (SDK internal property _clientVersion signals completion soon after connect)
    const originalInit = (server as any)._oninitialize;
    if(originalInit && !(server as any).__initPatched){
      (server as any).__initPatched = true;
      (server as any)._oninitialize = async function(request: any){
        const result = await originalInit.call(this, request);
        try {
          if(request?.params?.protocolVersion){
            (result as any).protocolVersion = request.params.protocolVersion;
          }
          if(result && typeof result === 'object' && !('instructions' in result)){
            (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health/check. Metrics: tools/call metrics/snapshot. Ping: ping.';
          }
          try { this.sendNotification({ method: 'server/ready', params: { version: baseVersion } }); } catch {/* ignore */}
        } catch {/* ignore */}
        return result;
      };
    }
    return;
  }
  const modServer: any = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
  const server = createSdkServer(modServer.Server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try { server.sendNotification({ method: 'server/ready', params: { } }); } catch { /* ignore */ }
  try { process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'server/ready', params:{} })+'\n'); } catch { /* ignore */ }
}
