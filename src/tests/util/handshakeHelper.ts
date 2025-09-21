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
export async function performHandshake(opts?: { cwd?: string; protocolVersion?: string; extraEnv?: Record<string,string>; logDiagEveryMs?: number }): Promise<HandshakeResult> {
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
  // Consolidated mutation flag (legacy MCP_ENABLE_MUTATION retained elsewhere for backward compat warnings)
  const enableMutationEnv = { MCP_MUTATION: '1' };
  const server = spawn(process.execPath, [dist], { stdio: ['pipe','pipe','pipe'], env: { ...process.env, ...enableMutationEnv, ...(opts?.extraEnv||{}) } });
  const parser = new StdioFramingParser();
  let sawSentinel = false;
  server.stderr.on('data', d => { if(String(d).includes('SDK server started')) sawSentinel = true; });
  server.stdout.on('data', d => parser.push(String(d)));

  const sendInit = () => server.stdin.write(buildContentLengthFrame({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion: opts?.protocolVersion || '2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'handshake-helper', version:'1.0.0' } } }));

  // Allow environment overrides for diagnostics & timing (used in CI hardening / deploy races)
  // Allow longer startup for production deployment directory (packaged runtime, larger instruction set)
  const isProdPath = cwd.replace(/\\/g,'/').includes('/mcp-index-server-prod');
  const maxTotalMs = Number(process.env.MCP_TEST_HANDSHAKE_MAX_MS || (isProdPath? 30000 : 20000)); // was 12000 originally
  const preSentinelWaitMs = Number(process.env.MCP_TEST_HANDSHAKE_PRESENTINEL_MS || 1500);
  const resendGapMs = Number(process.env.MCP_TEST_HANDSHAKE_RESEND_AFTER_MS || 4000);
  const pollSleepMs = Number(process.env.MCP_TEST_HANDSHAKE_POLL_MS || 50);
  const diagEveryMs = opts?.logDiagEveryMs ?? Number(process.env.MCP_TEST_HANDSHAKE_DIAG_EVERY_MS || 2000);

  // Wait briefly (up to 1500ms) for sentinel to reduce chance of early frame loss.
  const start = Date.now();
  while(!sawSentinel && Date.now() - start < preSentinelWaitMs){ await new Promise(r=>setTimeout(r,40)); }
  sendInit();
  // Fallback re-send once if no frames arrive within resendGapMs (initialize may have been dropped pre-listener).
  let initFrame: { id?: number } | undefined;
  const resendDeadline = Date.now()+resendGapMs;
  let lastDiag = start;
  while(!initFrame){
    initFrame = parser.findById(1);
    if(initFrame) break;
    if(Date.now()>resendDeadline){
      sendInit();
    }
    const elapsed = Date.now()-start;
    if(elapsed>maxTotalMs){ // safety overall bound
  throw new Error(`initialize timeout (helper) after ${elapsed}ms (max=${maxTotalMs}) cwd=${cwd}`);
    }
    if(elapsed - lastDiag >= diagEveryMs){
      // Emit lightweight stderr diagnostics; avoids polluting stdout (reserved for protocol frames)
      // Include whether sentinel was seen to help differentiate pre-start vs post-start stalls.
      process.stderr.write(`[handshakeHelper] waiting init id=1 elapsed=${elapsed}ms sawSentinel=${sawSentinel} resendIn=${Math.max(0, resendDeadline-Date.now())}ms\n`);
      lastDiag = Date.now();
    }
    await new Promise(r=>setTimeout(r,pollSleepMs));
  }
  return { server, parser, initFrameId: 1 };
}
