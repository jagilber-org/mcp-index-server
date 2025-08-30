import { describe, it, expect } from 'vitest';
import { startTransport, registerHandler } from '../server/transport';

// (Unused local harness code removed)

describe('transport unit (in-process)', () => {
  it('returns method not found for unknown method without crashing', async () => {
    // Use real Node streams via PassThrough for simplicity
    const { PassThrough } = await import('stream');
    const input = new PassThrough();
    const output = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = []; output.on('data', d => {
      const txt = d.toString();
      for(const line of txt.split(/\n+/).filter(Boolean)){ lines.push(line); }
    });
    startTransport({ input, output, stderr });
    // Consume the initial server/ready + tools/list_changed lines
    await new Promise(r => setTimeout(r, 20));
    input.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18' } })+'\n');
    input.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'does/notExist' })+'\n');
    const start = Date.now();
    let gotInit = false, gotErr = false;
    while(Date.now()-start < 500 && (!gotInit || !gotErr)){
      for(const l of lines){
        try { const o = JSON.parse(l); if(o.id===1 && o.result) gotInit=true; if(o.id===2 && o.error){ gotErr=true; } } catch { /* ignore */ }
      }
      if(gotInit && gotErr) break;
      await new Promise(r => setTimeout(r, 10));
    }
    expect(gotInit).toBe(true);
    expect(gotErr).toBe(true);
  });

  it('logs handler error and returns internal error response', async () => {
    const { PassThrough } = await import('stream');
    const input = new PassThrough();
    const output = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = []; output.on('data', d => { for(const line of d.toString().split(/\n+/).filter(Boolean)) lines.push(line); });
    const errLines: string[] = []; stderr.on('data', d => { errLines.push(...d.toString().split(/\n+/).filter(Boolean)); });
    // Register a temporary handler that throws
    registerHandler('test/boom', () => { throw new Error('boom'); });
    startTransport({ input, output, stderr, env:{ ...process.env, MCP_LOG_VERBOSE:'1' } });
    await new Promise(r => setTimeout(r, 15));
    input.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize' })+'\n');
    input.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'test/boom' })+'\n');
    const start = Date.now();
    let gotErr=false;
    while(Date.now()-start < 600 && !gotErr){
      for(const l of lines){
        try { const o = JSON.parse(l); if(o.id===2 && o.error){ gotErr=true; } } catch { /* ignore */ }
      }
      if(gotErr) break;
      await new Promise(r => setTimeout(r, 15));
    }
    expect(gotErr).toBe(true);
    // Ensure stderr recorded a handler_error log line
    const combinedErr = errLines.join('\n');
    expect(/handler_error/.test(combinedErr)).toBe(true);
  });
});
