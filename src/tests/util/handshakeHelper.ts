import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { StdioFramingParser, buildContentLengthFrame } from './stdioFraming.js';

export interface HandshakeResult { server: ChildProcessWithoutNullStreams; parser: StdioFramingParser; initFrameId: number; }

/**
 * Minimal shared handshake routine:
 *  - Spawns server (node dist/server/index.js)
 *  - Waits for either stderr sentinel or first frame window before sending initialize (up to 1500ms)
 *  - Sends initialize (id=1) and waits (up to 10s default parser timeout)
 *  - If no frame within 4000ms after send, re-sends initialize once (id=1 idempotent per MCP spec)
 *  - Returns process + parser once initialize response observed.
 */
export async function performHandshake(opts?: { cwd?: string; protocolVersion?: string; extraEnv?: Record<string,string> }): Promise<HandshakeResult> {
  let cwd = opts?.cwd || process.cwd();
  let dist = path.join(cwd, 'dist', 'server', 'index.js');
  // CI fallback: if provided cwd doesn't exist on this platform (e.g. Windows path on Linux runner),
  // fall back to current working directory so tests still exercise built server.
  const fs = await import('fs');
  if(!fs.existsSync(dist)){
    const candidate = path.join(process.cwd(), 'dist', 'server', 'index.js');
    if(fs.existsSync(candidate)){
      dist = candidate;
      cwd = process.cwd();
    }
  }
  const enableMutationEnv = { MCP_ENABLE_MUTATION: '1' };
  const server = spawn(process.execPath, [dist], { stdio: ['pipe','pipe','pipe'], env: { ...process.env, ...enableMutationEnv, ...(opts?.extraEnv||{}) } });
  const parser = new StdioFramingParser();
  let sawSentinel = false;
  server.stderr.on('data', d => { if(String(d).includes('SDK server started')) sawSentinel = true; });
  server.stdout.on('data', d => parser.push(String(d)));

  const sendInit = () => server.stdin.write(buildContentLengthFrame({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion: opts?.protocolVersion || '2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'handshake-helper', version:'1.0.0' } } }));

  // Wait briefly (up to 1500ms) for sentinel to reduce chance of early frame loss.
  const start = Date.now();
  while(!sawSentinel && Date.now() - start < 1500){ await new Promise(r=>setTimeout(r,40)); }
  sendInit();
  // Fallback re-send once if no frames arrive within 4s (initialize may have been dropped pre-listener).
  let initFrame: { id?: number } | undefined;
  const resendDeadline = Date.now()+4000;
  while(!initFrame){
    initFrame = parser.findById(1);
    if(initFrame) break;
    if(Date.now()>resendDeadline){
      sendInit();
    }
    if(Date.now()-start>12000){ // safety overall bound
      throw new Error('initialize timeout (helper)');
    }
    await new Promise(r=>setTimeout(r,50));
  }
  return { server, parser, initFrameId: 1 };
}
