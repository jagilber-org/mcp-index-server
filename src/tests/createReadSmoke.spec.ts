import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

// Minimal create→read contract smoke test against production deployment layout
// Fails fast on protocol contamination (non-JSON stdout lines containing braces/quotes)

describe('createReadSmoke', () => {
  it('initialize → tools/list → add → get works', async () => {
    const PRODUCTION_DIR = 'C:/mcp/mcp-index-server-prod';
    const START_SCRIPT = path.join(PRODUCTION_DIR, 'start.ps1');
    const TEST_ID = 'smoke-' + Date.now();

    const server = spawn('pwsh', ['-NoProfile', '-Command', `./${path.basename(START_SCRIPT)} -EnableMutation`], {
      cwd: PRODUCTION_DIR,
      env: { ...process.env, INSTRUCTIONS_DIR: path.join(PRODUCTION_DIR, 'instructions') },
      stdio: 'pipe'
    });

  // Envelope retains only top-level fields; inner shapes are dynamic per tool
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Frame { id?: number; result?: any; error?: any }
  const lines: Frame[] = [];
  let stdoutText = '';
  let stderrText = '';

    server.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdoutText += text;
      for(const rawLine of text.split(/\r?\n/)){
        const line = rawLine.trim();
        if(!line) continue;
        // Fast contamination guard: if it looks like log (starts with [startup] or [) but not JSON, fail
        if(line.startsWith('[')){
          throw new Error('stdout contamination: ' + line.slice(0,120));
        }
        try { lines.push(JSON.parse(line)); } catch {/* ignore non json */}
      }
    });
  server.stderr.on('data', c => { const t = c.toString(); stderrText += t; });

  const send = (m: Record<string, unknown>) => server.stdin.write(JSON.stringify(m)+'\n');
  const wait = (id: number, ms = 7000) => new Promise<Frame>((res, rej)=>{
      const start = Date.now();
      (function poll(){
        const found = lines.find(l=>l && l.id === id);
        if(found) return res(found);
        if(Date.now()-start>ms) return rej(new Error('timeout id='+id));
        setTimeout(poll,30);
      })();
    });

  // Send initialize immediately; rely on wait() timeout for readiness.
  send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'smoke', version:'1.0.0'} } });
  const init = await wait(1, 12000);
    expect(init.error,'init error').toBeFalsy();

    // Request tool list (may return either string[] or object[] with name properties per spec evolution)
    send({ jsonrpc:'2.0', id:2, method:'tools/list' });
    const list = await wait(2);
    const listObj = list as unknown as { result?: { tools?: unknown; capabilities?: { tools?: unknown } } };
    function extractNames(raw: unknown): string[] {
      if(!raw) return [];
      if(Array.isArray(raw)){
        if(raw.length === 0) return [];
        if(raw.every(t => typeof t === 'string')) return raw as string[];
        if(typeof raw[0] === 'object' && raw[0] && 'name' in (raw[0] as Record<string,unknown>)){
          return (raw as Record<string,unknown>[]).map(o => String(o.name));
        }
      }
      return [];
    }
    let toolNames: string[] = extractNames(listObj.result?.tools) || extractNames(listObj.result?.capabilities?.tools);
    // Retry a few times in case registry still warming (should be rare; defensive)
    if(!toolNames.includes('instructions/dispatch')){
      for(let attempt=0; attempt<3 && !toolNames.includes('instructions/dispatch'); attempt++){
        await new Promise(r => setTimeout(r, 100));
        const retryId = 2000 + attempt;
        send({ jsonrpc:'2.0', id: retryId, method:'tools/list' });
        // eslint-disable-next-line no-await-in-loop
        const retry = await wait(retryId);
        const retryObj = retry as unknown as { result?: { tools?: unknown; capabilities?: { tools?: unknown } } };
        toolNames = extractNames(retryObj.result?.tools) || extractNames(retryObj.result?.capabilities?.tools);
      }
    }
    expect(Array.isArray(toolNames),'tools list array').toBe(true);
    if(!toolNames.includes('instructions/dispatch')){
      // Provide rich diagnostics before failing
      throw new Error('dispatcher missing; raw tools payload(s)=' + JSON.stringify({ initial: listObj.result?.tools }, null, 2));
    }

    // Add new entry
    send({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id:TEST_ID, title:'Smoke', body:'Smoke test entry', priority:10, audience:'all', requirement:'recommended', categories:['test'] }, overwrite:true, lax:true }}});
    const add = await wait(3);
    expect(add.error,'add error').toBeFalsy();

    // Get the entry
    send({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id:TEST_ID }}});
    const get = await wait(4);
    expect(get.error,'get error').toBeFalsy();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const addObj = add as unknown as { result?: { content?: { text?: string }[] } };
  const addPayloadTxt = addObj.result?.content?.[0]?.text;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const getObj = get as unknown as { result?: { content?: { text?: string }[] } };
  const getPayloadTxt = getObj.result?.content?.[0]?.text;
  const addPayload = addPayloadTxt ? JSON.parse(addPayloadTxt) : {};
  const getPayload = getPayloadTxt ? JSON.parse(getPayloadTxt) : {};
  // Reference stdout/stderr to avoid unused warnings & provide context if assertions fail.
  expect(typeof stdoutText).toBe('string');
  expect(typeof stderrText).toBe('string');

    expect(addPayload.id,'add id echo').toBe(TEST_ID);
    expect(addPayload.verified,'verified flag').toBe(true);
    expect(getPayload.item?.id,'get id').toBe(TEST_ID);

    server.kill();
  }, 40000);
});
