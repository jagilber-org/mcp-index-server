// @vitest-environment node
// Vitest globals (describe,it,expect) provided by test runner.
import { spawn } from 'child_process';
import { describe, it } from 'vitest';
import path from 'path';
import { attachLineCollector, waitForServerReady, findResponse } from './testUtils';

// Stress test to surface intermittent downgrades of dispatcher semantic errors (-32602 / -32601) to -32603.
// Rapidly issues invalid and unknown action dispatches and asserts all returned codes are semantic.

describe('dispatcher semantic error stress', () => {
  it('never downgrades missing/unknown action errors (-32602/-32601) to -32603 across bursts', async () => {
    const server = spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_LOG_VERBOSE: process.env.CI? '':'1' } });
    const lines: string[] = []; attachLineCollector(server, lines);
    await waitForServerReady(server, lines);

    // Issue N bursts each with a missing action (no action field) and unknown action.
    const BURSTS = 20; // total 40 requests
    let nextId = 90000;
    for(let i=0;i<BURSTS;i++){
      const idMissing = nextId++;
      server.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:idMissing, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{} } })+'\n');
      const idUnknown = nextId++;
      server.stdin?.write(JSON.stringify({ jsonrpc:'2.0', id:idUnknown, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'__unknown__'+i } } })+'\n');
    }

    const deadline = Date.now() + 8000;
    // Wait for all responses
    while(Date.now() < deadline){
      const done = Array.from({ length: BURSTS*2 }).every((_,offset)=> !!findResponse(lines, 90000+offset));
      if(done) break;
      await new Promise(r=> setTimeout(r,40));
    }

    const failures: string[] = [];
    for(let offset=0; offset < BURSTS*2; offset++){
      const env = findResponse(lines, 90000+offset);
      if(!env || !env.error){ failures.push(`id=${90000+offset} missing error env=${JSON.stringify(env)}`); continue; }
      const code = env.error.code;
      const msg = env.error.message || '';
      // Expect only -32602 (missing action) or -32601 (unknown action)
      if(code !== -32602 && code !== -32601){
        failures.push(`id=${90000+offset} unexpected code=${code} msg=${msg}`);
      }
    }

    if(failures.length){
      // Include recent verbose lines for context
      const tail = lines.slice(-60).join('\n');
      server.kill();
      throw new Error(`Dispatcher semantic error downgrade detected:\n${failures.join('\n')}\n--- tail ---\n${tail}`);
    }
    server.kill();
  }, 15000);
});
