import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

// Ensures diagnostic synthetic initialize fallbacks do NOT trigger when MCP_INIT_FALLBACK_ALLOW is not enabled.
// If a fallback marker appears without explicit gating, test fails (guards protocol compliance drift).

function startServer(extraEnv: Record<string,string> = {}){
  return spawn('node', [path.join(process.cwd(),'dist','server','index.js')], {
    stdio:['pipe','pipe','pipe'],
    env:{ ...process.env, MCP_HEALTH_MIXED_DIAG:'1', MCP_LOG_VERBOSE:'0', ...extraEnv } // diag on to capture markers, but gating off
  });
}

function collect(stream: NodeJS.ReadableStream, sink: string[]){
  let buf='';
  stream.on('data', d=>{ buf += d.toString(); const parts = buf.split(/\n/); buf = parts.pop()!; for(const l of parts){ const t=l.trim(); if(t) sink.push(t); } });
}

function wait(ms:number){ return new Promise(r=> setTimeout(r, ms)); }

const MARKERS = [
  'sniff_init_forced_result_emit',
  'init_unconditional_fallback_emit',
  'sniff_init_synthetic_dispatch'
];

describe('initialize compliance (no unintended synthetic fallback)', () => {
  it('does not emit synthetic initialize markers when fallback gating env disabled', async () => {
    const server = startServer();
    const out: string[] = []; const err: string[] = [];
    collect(server.stdout,out); collect(server.stderr,err);
    // normal initialize
    server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{} })+'\n');
    // wait briefly for response
    await wait(300);
    // send a simple health request to ensure server alive
    server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'health/check', params:{} })+'\n');
    await wait(300);
    server.kill();
    const stderrText = err.join('\n');
    const hits = MARKERS.filter(m=> stderrText.includes(m));
    expect(hits).toEqual([]);
  }, 5000);
});
