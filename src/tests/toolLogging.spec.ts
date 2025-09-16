import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn } from 'child_process';

// RED test: asserts that invoking a simple tool will write tool_start/tool_end lines to log
// Currently this is expected to FAIL because logging of tool events is gated by MCP_LOG_TOOLS env.
// We'll make it pass by removing that gate in a subsequent change (green phase).

function wait(ms:number){ return new Promise(r=>setTimeout(r,ms)); }

describe('Tool logging integration (red)', () => {
  // Use isolated log file (avoid cross-test interference with shared logs/mcp-server.log)
  const testLogDir = path.join(process.cwd(),'tmp','tool-logging-test');
  const logFile = path.join(testLogDir,'log.log');
  let proc: ReturnType<typeof spawn> | null = null;

  let stderrBuf = '';
  let stdoutBuf = '';

  beforeAll(async () => {
    if(!fs.existsSync(testLogDir)) fs.mkdirSync(testLogDir,{recursive:true});
    if(fs.existsSync(logFile)) fs.unlinkSync(logFile);
    // Start server (tool lifecycle logging now unconditional)
    proc = spawn(process.execPath, ['dist/server/index.js'], {
      cwd: process.cwd(),
      env: { ...process.env, MCP_LOG_FILE: logFile, MCP_DASHBOARD: '0', MCP_LOG_SYNC: '1' },
      stdio: 'pipe'
    });
  proc.stderr?.on('data', d => { stderrBuf += d.toString(); });
  proc.stdout?.on('data', d => { stdoutBuf += d.toString(); });
    // Allow startup
    const startWait = Date.now();
    while(Date.now()-startWait < 5000){
      if(/server_started/.test(stderrBuf)) break;
      await wait(50);
    }
  }, 10000);

  afterAll(async () => {
    if(proc){ proc.kill(); proc = null; }
    // Prevent unused var lint for captured stdout (could be used for future diagnostics)
    if(stdoutBuf.length < 0) console.log('');
    await wait(200);
  });

  test('invoking metrics/snapshot (via tools/call) emits tool_start/tool_end in isolated log file', async () => {
    // Perform minimal initialize handshake first (protocol expects initialize before other calls)
    const initReq = JSON.stringify({ jsonrpc:'2.0', id:0, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{} } }) + '\n';
    proc?.stdin?.write(initReq);
    // Wait briefly for initialize processing
    await wait(400);
  // Invoke a guaranteed-registered stable tool with trivial execution
  const toolsReq = JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'metrics/snapshot', arguments:{} } }) + '\n';
    proc?.stdin?.write(toolsReq);
    // Poll log file up to 3s for tool_start/end lines (allowing for lazy file init + write flush)
    let found = false;
    const deadline = Date.now() + 3000;
    while(Date.now() < deadline){
      const content = fs.existsSync(logFile) ? fs.readFileSync(logFile,'utf8') : '';
      if(/tool_start/.test(content) && /tool_end/.test(content)){
        found = true; break;
      }
      await wait(120);
    }
    expect(found).toBe(true);
  }, 10000);
});
