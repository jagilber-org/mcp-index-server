import { createInterface } from 'readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}
interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export type Handler<TParams = unknown> = (params: TParams) => Promise<unknown> | unknown;

const handlers: Record<string, Handler> = {
  'health/check': () => ({ status: 'ok', timestamp: new Date().toISOString(), version: '0.1.0' })
};

export function registerHandler<TParams=unknown>(method: string, handler: Handler<TParams>){
  handlers[method] = handler as Handler;
}

function makeError(id: string | number | null | undefined, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

function respond(obj: JsonRpcResponse){
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function startTransport(){
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Emit ready notification (MCP-style event semantics placeholder)
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/ready', params: { version: '0.1.0' } }) + '\n');
  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if(!trimmed) return;
    if(trimmed === 'quit'){ process.exit(0); }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch(err){
      respond(makeError(null, -32700, 'Parse error'));
      return;
    }
    if(req.jsonrpc !== '2.0' || !req.method){
      respond(makeError(req.id ?? null, -32600, 'Invalid Request'));
      return;
    }
    const handler = handlers[req.method];
    if(!handler){
      respond(makeError(req.id ?? null, -32601, 'Method not found'));
      return;
    }
    try {
      const result = handler(req.params);
      Promise.resolve(result).then(r => {
        if(req.id !== undefined && req.id !== null){
          respond({ jsonrpc: '2.0', id: req.id, result: r });
        }
      });
    } catch(e: unknown){
      const errMsg = e instanceof Error ? e.message : 'Unknown error';
      respond(makeError(req.id ?? null, -32603, 'Internal error', { message: errMsg }));
    }
  });
}

if(require.main === module){
  startTransport();
}
