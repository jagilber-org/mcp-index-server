import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

function wait(ms:number){ return new Promise(r=>setTimeout(r,ms)); }

// Integration test: exercise the dashboard synthetic activity route and verify
// that tool_start/tool_end events are emitted into the main log. This mirrors
// the UI "synthetic activity" button.

describe('Dashboard synthetic activity logging', () => {
  const logsDir = path.join(process.cwd(),'logs');
  const logFile = path.join(logsDir,'mcp-server.log');
  let proc: ReturnType<typeof spawn> | null = null;
  let port = 0;

  beforeAll(async () => {
    if(!fs.existsSync(logsDir)) fs.mkdirSync(logsDir,{recursive:true});
    if(fs.existsSync(logFile)) fs.unlinkSync(logFile);
    // Select a random high port
    port = 18000 + Math.floor(Math.random()*1000);
    proc = spawn(process.execPath, ['dist/server/index.js', `--dashboard-port=${port}`, '--dashboard-host=127.0.0.1'], {
      cwd: process.cwd(),
      env: { ...process.env, MCP_LOG_FILE: '1', MCP_DASHBOARD: '1' },
      stdio: 'pipe'
    });
    // Give server time to start and load catalog
    // Allow more startup time on slower CI runners; poll for readiness
    const start = Date.now();
    let ready = false;
    while(Date.now() - start < 5000){
      try {
        await new Promise((resolve, reject) => {
          const req = http.request({ method:'GET', hostname:'127.0.0.1', port, path:'/api/status' }, res => { res.resume(); res.on('end', resolve); });
          req.on('error', reject); req.end();
        });
        ready = true; break;
      } catch { await wait(250); }
    }
    if(!ready) await wait(1000); // fallback grace
  }, 30000);

  afterAll(async () => {
    if(proc){ proc.kill(); proc = null; }
    await wait(200);
  });

  test('synthetic activity POST triggers tool_start/tool_end logging', async () => {
    const body = JSON.stringify({ iterations: 5, concurrency: 2 });
    const resData: string = await new Promise((resolve, reject) => {
      const req = http.request({ method:'POST', hostname:'127.0.0.1', port, path:'/api/admin/synthetic/activity', headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) }}, (res) => {
        let data='';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(resData).toMatch(/"success":true/);
    // Retry log scan up to 5 times to reduce flakiness
    let logSnapshot=''; let attempts=0;
    while(attempts < 5){
      logSnapshot = fs.existsSync(logFile) ? fs.readFileSync(logFile,'utf8') : '';
      if(/tool_start/.test(logSnapshot) && /tool_end/.test(logSnapshot)) break;
      await wait(300);
      attempts++;
    }
    const content = logSnapshot;
    const startMatches = content.match(/tool_start/g) || [];
    const endMatches = content.match(/tool_end/g) || [];
    expect(startMatches.length).toBeGreaterThan(0);
    expect(endMatches.length).toBeGreaterThan(0);
  }, 25000);
});
