import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

describe('diagnostics startup', () => {
  it('emits diagnostics line when MCP_LOG_DIAG=1', async () => {
    const proc = spawn('node',[path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_LOG_DIAG:'1' } });
    let joined = '';
    proc.stderr.on('data', d=> { joined += d.toString(); });
    const start = Date.now();
    while(!joined.includes('toolsRegistered') && Date.now()-start < 4000){
      await new Promise(r=> setTimeout(r,50));
    }
    expect(joined.includes('toolsRegistered')).toBe(true);
    proc.kill();
  }, 8000);
});
