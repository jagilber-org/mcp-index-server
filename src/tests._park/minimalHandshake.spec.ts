import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

function run(init: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const proc = spawn(process.execPath, [path.join(process.cwd(), 'dist', 'minimal', 'index.js')], {
      env: { ...process.env, MCP_MINIMAL_DEBUG: '1' }
    });
    let done = false;
    // More robust initialize detector: parse JSON lines and look for result.serverInfo.name === 'mcp-minimal-server'
    const hasInit = () => lines.some(l => {
      if(l.startsWith('[stderr]') || !l.startsWith('{')) return false;
      try { const o = JSON.parse(l); return !!(o && o.id === 1 && o.result && o.result.serverInfo && o.result.serverInfo.name === 'mcp-minimal-server'); } catch { return false; }
    });
    const hasReady = () => lines.some(l => l.includes('server/ready'));
    const hasSentinel = () => lines.some(l => /"method":"minimal\/handshake_sentinel"/.test(l));
    const hasListChanged = () => lines.some(l => l.includes('tools/list_changed'));

    // Graceful shutdown sequence instead of immediate kill (Windows pipe truncation safeguard)
    function gracefulResolve(tag: string){
      if(done) return;
      done = true;
      lines.push(`[stderr] [minimalHandshake] resolving (${tag}) lineCount=${lines.length}`);
      // Attempt graceful shutdown to flush stdout fully
  try { proc.stdin.write('{"jsonrpc":"2.0","id":9,"method":"shutdown"}\n'); } catch { /* ignore */ }
  try { proc.stdin.write('{"jsonrpc":"2.0","id":10,"method":"exit"}\n'); } catch { /* ignore */ }
      // Allow a short delay for any buffered data + shutdown acks
      setTimeout(()=> resolve(lines), 40);
    }

    const maybeFinish = () => {
      if (done) return;
      const initNow = hasInit();
      const readyNow = hasReady();
      const listChangedNow = hasListChanged();
      const sentinelNow = hasSentinel();
      // Require sentinel as an ordering witness to avoid resolving before full initialize line fully buffered.
      if (initNow && sentinelNow && readyNow && listChangedNow) {
        gracefulResolve(`init=${initNow} ready=${readyNow} listChanged=${listChangedNow}`);
      }
    };

    // Robust line assembly + raw chunk diagnostics
    let stdoutBuf = '';
    proc.stdout.on('data', d => {
      const raw = d instanceof Buffer ? d.toString('utf8') : String(d);
      lines.push('[stderr] [minimalHandshake][chunk] len=' + raw.length + ' preview=' + JSON.stringify(raw.slice(0,120)));
      stdoutBuf += raw;
      for(;;){
        const nl = stdoutBuf.indexOf('\n');
        if(nl === -1) break;
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, '');
        stdoutBuf = stdoutBuf.slice(nl+1);
        if(line) lines.push(line);
      }
      maybeFinish();
    });
    proc.stdout.on('end', () => { if(stdoutBuf.trim()) lines.push(stdoutBuf.trim()); });
    proc.stderr.on('data', d => {
      d.toString('utf8').split(/\r?\n/).filter(Boolean).forEach((l: string) => lines.push('[stderr] ' + l));
    });
    proc.on('error', e => { if (!done) { done = true; reject(e); } });

    // Defer initialize slightly so stdout listeners are guaranteed attached
    setTimeout(() => { try { proc.stdin.write(init + '\n'); } catch { /* ignore */ } }, 10);
    const timeoutMs = 8000;
  const anomalyInterval = setInterval(()=>{
      if(done){ clearInterval(anomalyInterval); return; }
      if(hasReady() && !hasInit()) lines.push('[stderr] [minimalHandshake] anomaly: ready without initialize result yet');
      if(hasSentinel() && !hasInit()) lines.push('[stderr] [minimalHandshake] anomaly: sentinel without initialize result');
    }, 120);
    setTimeout(() => {
      if (!done) {
        if(!hasInit()) lines.push('[stderr] [minimalHandshake] timeout without initialize result');
        gracefulResolve('timeout');
        clearInterval(anomalyInterval);
      }
    }, timeoutMs);
  });
}

// Run sequentially to avoid stdout interleaving with other spawn-heavy suites.
describe.sequential('minimal server handshake', () => {
  it('initialize result precedes exactly one ready', async () => {
    const lines = await run('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}');
    
    // Find initialize result
    const initIdx = lines.findIndex(l=> {
      if(l.startsWith('[stderr]') || !l.startsWith('{')) return false;
      try { 
        const o = JSON.parse(l); 
        return !!(o && o.id === 1 && o.result && o.result.serverInfo && o.result.serverInfo.name === 'mcp-minimal-server'); 
      } catch { return false; }
    });
    
    if(initIdx === -1){
      // Provide diagnostic output for flake triage
      console.error('[minimalHandshake] collected lines (missing initialize result):');
      for(const [i,l] of lines.entries()){ 
        console.error(`  [${i}] ${l}`); 
      }
      const sentinelIdx = lines.findIndex(l=> /"method":"minimal\/handshake_sentinel"/.test(l));
      console.error('[minimalHandshake] sentinelIdx='+sentinelIdx);
      const jsonLines = lines.filter(l=> l.startsWith('{')).length;
      console.error('[minimalHandshake] totalLines='+lines.length+' jsonLines='+jsonLines);
    }
    expect(initIdx).toBeGreaterThanOrEqual(0);
    
    // Find all server/ready messages
    const readyIdxs = lines.map((l,i)=>{
      if(l.startsWith('[stderr]')) return -1;
      if(!l.startsWith('{')) return -1;
      try { 
        const o = JSON.parse(l); 
        return o && o.method === 'server/ready' ? i : -1; 
      } catch { return -1; }
    }).filter(i=> i!==-1);
    
    if(readyIdxs.length !== 1){
      console.error('[minimalHandshake] unexpected ready count=', readyIdxs.length);
      for(const [i,l] of lines.entries()) {
        if(l.includes('server/ready')) console.error(`  ready at [${i}]: ${l}`);
      }
    }
    expect(readyIdxs.length).toBe(1);
    expect(readyIdxs[0]).toBeGreaterThan(initIdx);
    
    // Optional: list_changed follows ready.
    const listChangedIdx = lines.findIndex(l=> !l.startsWith('[stderr]') && /"method":"notifications\/tools\/list_changed"/.test(l));
    expect(listChangedIdx).toBeGreaterThan(readyIdxs[0]);
  }, 5000);
});
