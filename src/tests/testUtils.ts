export async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 40): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return predicate();
}

// Parse a tools/call success line and return decoded inner JSON payload (content[0].text) if present
export function parseToolPayload<T=unknown>(line: string): T | undefined {
  try {
    const outer = JSON.parse(line);
    const text = outer.result?.content?.[0]?.text;
    if (typeof text === 'string') {
      try { return JSON.parse(text) as T; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return undefined;
}

// Minimal JSON-RPC envelope type used in tests
export interface RpcEnvelope {
  id?: number;
  result?: unknown;
  error?: { code: number; message?: string; data?: unknown };
}

// Assert (optionally) that an envelope satisfies XOR invariant: exactly one of result or error present (and id defined unless notification)
export function xorResultError(e: RpcEnvelope): boolean {
  // Notifications have no id and no result/error; only enforce when id is present
  if (e.id === undefined) return true;
  const hasResult = e.result !== undefined;
  const hasError = e.error !== undefined;
  return (hasResult ? 1 : 0) + (hasError ? 1 : 0) === 1;
}

// Shared response finder: returns the first parsed line matching id that has either result or error
export function findResponse(lines: string[], id: number): RpcEnvelope | undefined {
  for (const l of lines) {
    try {
      const o = JSON.parse(l) as RpcEnvelope;
      if (o && o.id === id && (o.result !== undefined || o.error !== undefined)) return o;
    } catch { /* ignore malformed */ }
  }
  return undefined;
}

// Convenience wait helper for an id (wraps waitFor). Returns the envelope if found else undefined.
export async function waitForResponse(lines: string[], id: number, timeoutMs = 4000): Promise<RpcEnvelope | undefined> {
  await waitFor(() => !!findResponse(lines, id), timeoutMs);
  return findResponse(lines, id);
}

// Deterministic getResponse: waits then returns envelope or throws with diagnostic context
export async function getResponse(lines: string[], id: number, timeoutMs = 4000): Promise<RpcEnvelope> {
  const ok = await waitFor(() => !!findResponse(lines, id), timeoutMs);
  if(!ok){
    // include last few lines for debugging
    const tail = lines.slice(-10).join('\n');
    throw new Error(`Timeout waiting for response id=${id}. Tail:\n${tail}`);
  }
  const env = findResponse(lines, id)!;
  if(!xorResultError(env)) {
    throw new Error(`Invariant violation (result XOR error) for id=${id}: ${JSON.stringify(env)}`);
  }
  return env;
}

// Wait for a file to appear (and optionally satisfy a predicate) up to timeout
import fs from 'fs';
export async function waitForFile(filePath: string, timeoutMs = 4000, predicate: (txt: string)=>boolean = ()=>true): Promise<string> {
  const start = Date.now();
  let content = '';
  while(Date.now() - start < timeoutMs){
    if(fs.existsSync(filePath)){
      try { content = fs.readFileSync(filePath,'utf8'); if(predicate(content)) return content; } catch { /* ignore read race */ }
    }
    await new Promise(r=> setTimeout(r, 40));
  }
  if(fs.existsSync(filePath)){
    content = fs.readFileSync(filePath,'utf8');
  }
  throw new Error(`waitForFile timeout (${timeoutMs}ms) path=${filePath}`);
}

  // Convenience: only wait for existence (no JSON parse).
  export async function ensureFileExists(filePath:string, timeoutMs=4000, intervalMs=50):Promise<void>{
    const start = Date.now();
    while(Date.now() - start < timeoutMs){
      if(fs.existsSync(filePath)) return;
      await new Promise(r=> setTimeout(r, intervalMs));
    }
    throw new Error(`timeout waiting for file ${filePath}`);
  }

  // Wait for a file to be removed (inverse of ensureFileExists)
  export async function ensureFileGone(filePath:string, timeoutMs=4000, intervalMs=50):Promise<void>{
    const start = Date.now();
    while(Date.now() - start < timeoutMs){
      if(!fs.existsSync(filePath)) return;
      await new Promise(r=> setTimeout(r, intervalMs));
    }
    throw new Error(`timeout waiting for file removal ${filePath}`);
  }

// Send a JSON-RPC message to a spawned server process
function send(proc: { stdin?: NodeJS.WritableStream|null }, msg: Record<string, unknown>){
  proc.stdin?.write(JSON.stringify(msg) + '\n');
}

interface ServerReadyOptions {
  initId?: number;
  metaId?: number;
  timeoutMs?: number; // total budget for each phase
  capabilities?: Record<string, unknown>;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
}

// Waits for MCP server readiness by performing initialize then meta/tools call.
// Returns the meta/tools outer JSON-RPC envelope (with result.content[0].text) or undefined on timeout.
// This aligns with MCP protocol (initialize first; tools/call for registry) and avoids ad-hoc sleeps.
export async function waitForServerReady(proc: { stdin?: NodeJS.WritableStream|null }, lines: string[], opts: ServerReadyOptions = {}){
  const {
    initId = 7000,
    metaId = 7001,
    timeoutMs = 5000,
    capabilities = { tools: {} },
    clientName = 'test-harness',
    clientVersion = '0.0.0',
    protocolVersion = '2025-06-18'
  } = opts;

  // If initialize response already present, skip sending again (support reuse in some tests)
  const hasInit = () => !!findResponse(lines, initId);
  if(!hasInit()){
    send(proc, { jsonrpc:'2.0', id: initId, method:'initialize', params:{ protocolVersion, clientInfo:{ name:clientName, version:clientVersion }, capabilities } });
  }
  await waitFor(hasInit, timeoutMs);

  const hasMeta = () => !!findResponse(lines, metaId);
  if(!hasMeta()){
    send(proc, { jsonrpc:'2.0', id: metaId, method:'tools/call', params:{ name:'meta/tools', arguments:{} } });
  }
  await waitFor(hasMeta, timeoutMs);
  return findResponse(lines, metaId);
}
