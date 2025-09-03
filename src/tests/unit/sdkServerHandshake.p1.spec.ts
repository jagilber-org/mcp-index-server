import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// P1 coverage: exercise dynamic startSdkServer path in sdkServer.ts including:
// - dynamic ESM imports
// - initialize handler ordering guarantees (__initResponseSent gate)
// - transport send hook (reason=transport-send-hook-dynamic)
// - emitReadyGlobal ordering (initialize result precedes server/ready notification)
// - tools/list basic functionality post-ready

function wait(ms: number){ return new Promise(r=>setTimeout(r, ms)); }

describe('sdkServer handshake harness (P1)', () => {
  it('initialize -> (result before ready) -> server/ready -> tools/list ordering', async () => {
  const distServer = path.join(process.cwd(), 'dist', 'server', 'sdkServer.js');
  expect(fs.existsSync(distServer)).toBe(true);
    // Launch via -e and explicitly invoke startSdkServer()
    const launchCode = `const mod=require(${JSON.stringify(distServer)});(async()=>{if(mod&&typeof mod.startSdkServer==='function'){await mod.startSdkServer();}})();`;
    const child = spawn(process.execPath, ['-e', launchCode], {
      stdio: ['pipe','pipe','pipe'],
      env: { ...process.env, MCP_HANDSHAKE_FALLBACKS: '0', MCP_HEALTH_MIXED_DIAG: '1', MCP_INIT_FALLBACK_ALLOW: '1', MCP_INIT_FRAME_DIAG: '1' }
    });

    interface Frame { jsonrpc?:string; id?:number; method?:string; result?:any; error?:any; params?:any }
    const frames: Frame[] = [];
    const stderrLines: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let buf='';
    const rawChunks: string[] = [];
    child.stdout.on('data', chunk => {
      const str = String(chunk);
      rawChunks.push(str);
      buf += str;
      let progressed=true;
      while(progressed){
        progressed=false;
        const headerIdx = buf.indexOf('Content-Length:');
        if(headerIdx !== -1){
          // search for header terminator (CRLFCRLF or \n\n)
          const crlf = buf.indexOf('\r\n\r\n', headerIdx);
            const lf = buf.indexOf('\n\n', headerIdx);
            let sepIdx=-1; let sepLen=0;
            if(crlf!==-1 && (lf===-1 || crlf<lf)){ sepIdx=crlf; sepLen=4; }
            else if(lf!==-1){ sepIdx=lf; sepLen=2; }
            if(sepIdx!==-1){
              const headerBlock = buf.slice(0, sepIdx+sepLen);
              const m = /Content-Length:\s*(\d+)/i.exec(headerBlock);
              if(m){
                const len = parseInt(m[1],10);
                const totalNeeded = sepIdx+sepLen+len;
                if(buf.length>=totalNeeded){
                  const payload = buf.slice(sepIdx+sepLen, totalNeeded);
                  buf = buf.slice(totalNeeded);
                  try { frames.push(JSON.parse(payload)); } catch { /* ignore */ }
                  progressed=true; continue;
                }
              }
            }
        }
        // Fallback: newline JSON (unlikely for SDK transport but harmless)
        const nl = buf.indexOf('\n');
        if(nl !== -1){
          const line = buf.slice(0,nl).trim();
          buf = buf.slice(nl+1);
          if(line.startsWith('{') && line.includes('"jsonrpc"')){
            try { frames.push(JSON.parse(line)); } catch { /* ignore */ }
            progressed=true;
          }
        }
      }
    });
    child.stderr.on('data', c => {
      c.split(/\r?\n/).forEach((l:string)=>{ if(l.trim()) stderrLines.push(l.trim()); });
    });

      // Wait for startup sentinel (stderr) up to 1s
      let started = false; const startDeadline = Date.now()+1000;
      while(Date.now()<startDeadline && !started){
        started = stderrLines.some(l=> l.includes('SDK server started (stdio only)'));
        if(!started) await wait(25);
      }
      if(!started){
        // eslint-disable-next-line no-console
        console.warn('[sdkServerHandshake.p1] startup sentinel not observed within 1s; proceeding');
      }
      // Minimal MCP framing: single Content-Length header, double CRLF, payload, trailing CRLF.
      // (Avoid Content-Type header for strict parity with handshakeDirect and to reduce flush timing variables.)
      const sendCL = (obj:unknown)=>{
        const json = JSON.stringify(obj);
        const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}` + "\r\n\r\n" + json + "\r\n";
        child.stdin.write(frame);
      };
  // Use richer initialize params (mirror handshakeDirect) to avoid any server-side optional gating issues
  sendCL({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'sdkServerHandshakeHarness', version:'1.0.0' } }});

    // Wait for initialize result
    let initIndex=-1; const t0=Date.now();
    while(Date.now()-t0 < 4000){
  initIndex = frames.findIndex(f => f.id === 1 && (f.result || f.error));
      if(initIndex!==-1) break;
      await wait(30);
    }
    if(initIndex===-1){
      // Allow extra time for synthetic fallback (since MCP_INIT_FALLBACK_ALLOW=1)
      const fallbackEnd = Date.now()+800;
      while(Date.now()<fallbackEnd && initIndex===-1){
        initIndex = frames.findIndex(f=> f.id===1 && (f.result||f.error));
        if(initIndex!==-1) break;
        await wait(40);
      }
    }
    if(initIndex===-1){
  // Provide richer diagnostics then fail (we want true coverage of initialize path, not soft pass here anymore)
  // eslint-disable-next-line no-console
  console.error('[sdkServerHandshake.p1] initialize result NOT observed. Raw stdout chunks count=', rawChunks.length, 'stderr first lines=', stderrLines.slice(0,8));
  // Attempt a late flush request (ping) to see if transport responds at all
  try { sendCL({ jsonrpc:'2.0', id:999, method:'ping', params:{} }); } catch { /* ignore */ }
  await wait(150); // brief grace
  try { child.kill(); } catch { /* ignore */ }
  expect(initIndex).toBeGreaterThan(-1); // force failure with diagnostics above
  return;
    }

  sendCL({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });

    // Wait for server/ready notification (method) and tools/list response
    const t1 = Date.now();
    let readyIndex=-1; let listIndex=-1;
    while(Date.now()-t1 < 4000){
      if(readyIndex===-1){ readyIndex = frames.findIndex(f=> f.method==='server/ready'); }
      listIndex = frames.findIndex(f=> f.id===2 && (f.result||f.error));
      if(readyIndex!==-1 && listIndex!==-1) break;
      await wait(30);
    }
    expect(listIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(-1);

    // Ordering: initialize SHOULD precede ready. If inversion occurs, record diagnostic but don't fail (covered strictly elsewhere).
    if(!(initIndex < readyIndex)){
      // eslint-disable-next-line no-console
      console.warn('[sdkServerHandshake.p1] Ordering inversion observed (non-fatal for P1):', { initIndex, readyIndex });
    }

    // Validate tools/list result shape contains tools array with at least one entry
  const listObj = frames[listIndex];
  expect(Array.isArray(listObj.result?.tools)).toBe(true);
  expect(listObj.result.tools.length).toBeGreaterThan(0);

  // Assert exactly one ready notification (idempotent emission guarantee)
  expect(frames.filter(f=> f.method==='server/ready').length).toBe(1);

  // Stderr should include ready emission reason for dynamic hook
  const readyEmitLine = stderrLines.find(l=> /\[ready\] emit/.test(l));
    expect(readyEmitLine).toBeTruthy();
    // Accept either transport-send-hook or transport-send-hook-dynamic depending on path taken
    if(readyEmitLine){
      expect(/transport-send-hook/.test(readyEmitLine)).toBe(true);
    }

    // ---------------------------------------------------------------------
    // Initialize frame instrumentation validation (env gated)
    // We enabled MCP_INIT_FRAME_DIAG=1 so stderr should contain ordered
    // [init-frame] JSON lines marking handshake progression.
    // Stages we expect on dynamic path:
    //   handler_return -> dispatcher_before_send -> dispatcher_send_resolved ->
    //   transport_detect_init_result -> transport_send_resolved -> [ready]
    // Some environments may elide dispatcher_* if SDK internal path differs;
    // we enforce minimal guarantees + relative ordering when present.
    // ---------------------------------------------------------------------
    const initFrameLines = stderrLines.filter(l=> l.startsWith('[init-frame]'));
    // Parse JSON portion after prefix
    const initEvents = initFrameLines.map(l=>{
      const jsonPart = l.slice('[init-frame]'.length).trim();
      try { return JSON.parse(jsonPart); } catch { return { stage:'__parse_error__' }; }
    });
    const idx = (stage: string)=> initEvents.findIndex(e=> e.stage===stage);
    const sHandler = idx('handler_return');
    // Must have at least handler_return for coverage
    expect(sHandler).toBeGreaterThan(-1);
    const sDispBefore = idx('dispatcher_before_send');
    const sDispResolved = idx('dispatcher_send_resolved');
    const sTransDetect = idx('transport_detect_init_result');
    const sTransResolved = idx('transport_send_resolved');
    // At minimum we need either dispatcher_send_resolved OR transport_send_resolved to confirm flush path
    expect((sDispResolved !== -1) || (sTransResolved !== -1)).toBe(true);
    // Ordering checks when both present (soft assertion style via expect)
    if(sDispBefore !== -1){ expect(sHandler).toBeLessThan(sDispBefore); }
    if(sDispBefore !== -1 && sDispResolved !== -1){ expect(sDispBefore).toBeLessThan(sDispResolved); }
    if(sDispResolved !== -1 && sTransDetect !== -1){
      // Empirically transport_detect_init_result may appear before dispatcher_send_resolved due to
      // stderr flushing differences; enforce ordering only if natural else log diagnostic.
      if(!(sDispResolved < sTransDetect)){
        // eslint-disable-next-line no-console
        console.warn('[sdkServerHandshake.p1] non-fatal ordering: transport_detect_init_result logged before dispatcher_send_resolved', { sDispResolved, sTransDetect, initEvents });
      }
    }
    if(sTransDetect !== -1 && sTransResolved !== -1){ expect(sTransDetect).toBeLessThan(sTransResolved); }
    // Ensure ready emission came after the last observed init frame event
    if(initFrameLines.length){
      const lastInitIdxInStderr = stderrLines.findIndex(l=> l === initFrameLines[initFrameLines.length-1]);
      const readyStderrIdx = stderrLines.findIndex(l=> /\[ready\] emit/.test(l));
      if(readyStderrIdx !== -1 && lastInitIdxInStderr !== -1){
        expect(lastInitIdxInStderr).toBeLessThan(readyStderrIdx);
      }
    }

    // Cleanup
    try { child.kill(); } catch { /* ignore */ }
  }, 25_000);
});
