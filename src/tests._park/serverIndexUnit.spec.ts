import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import { _parseArgs, _startDashboard, _findPackageVersion } from '../server/index';

// Helper to capture stderr output during a function's execution
type CaptureResult<T> = { ok: true; value: T; stderr: string } | { ok: false; error: unknown; stderr: string };
function captureStderr<T>(fn: () => Promise<T> | T): Promise<CaptureResult<T>> {
  const origWrite = process.stderr.write.bind(process.stderr);
  const bufs: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown) => { bufs.push(String(chunk)); return true; };
  const finish = (r: CaptureResult<T>): CaptureResult<T> => {
    // restore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = origWrite;
    return r;
  };
  return Promise.resolve()
    .then(() => fn())
    .then(v => finish({ ok: true, value: v, stderr: bufs.join('') }))
    .catch(err => finish({ ok: false, error: err, stderr: bufs.join('') }));
}

describe('server/index unit (argument parsing & dashboard)', () => {
  it('parseArgs parses dashboard flags (long & assignment forms)', () => {
    const cfg = _parseArgs(['node','script', '--dashboard', '--dashboard-port=9999', '--dashboard-host=127.0.0.1', '--dashboard-tries=3']);
    expect(cfg.dashboard).toBe(true);
    expect(cfg.dashboardPort).toBe(9999);
    expect(cfg.dashboardHost).toBe('127.0.0.1');
    expect(cfg.maxPortTries).toBe(3);
  });

  it('parseArgs --help triggers exit after printing help', async () => {
  const exitSpy = vi.spyOn(process, 'exit');
  exitSpy.mockImplementation((code?: string | number | null) => { throw new Error('EXIT '+code); }) as unknown as (code?: string | number | null | undefined) => never;
    const cap = await captureStderr(() => _parseArgs(['node','script','--help']));
    expect(cap.stderr).toMatch(/mcp-index-server/i);
    expect(cap.ok).toBe(false);
    if(!cap.ok){
      const msg = (cap.error as Error).message;
      expect(msg).toMatch(/EXIT 0/);
    }
  (exitSpy as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('startDashboard success returns url', async () => {
    // Pick a likely free high port; retries minimal
    const cfg = { dashboard: true, dashboardPort: 28976, dashboardHost: '127.0.0.1', maxPortTries: 2, legacy: false };
    const cap = await captureStderr(() => _startDashboard(cfg));
    expect(cap.ok).toBe(true);
    if(cap.ok){
      expect(cap.value).not.toBeNull();
      expect(cap.value?.url).toMatch(/http:\/\/127\.0\.0\.1:28976\//);
    }
  });

  it('startDashboard failure path logs error when port occupied', async () => {
    // Occupy a port then attempt with maxPortTries=1
    const server = http.createServer((_, res) => { res.end('x'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr && 'port' in addr ? (addr as { port: number }).port : 0;
    // Keep server open so port is in-use during startDashboard
    const cfg = { dashboard: true, dashboardPort: port, dashboardHost: '127.0.0.1', maxPortTries: 1, legacy: false };
    const cap = await captureStderr(() => _startDashboard(cfg));
    expect(cap.ok).toBe(true); // function resolves successfully
    if(cap.ok){
      expect(cap.value).toBeNull();
    }
    expect(cap.stderr).toMatch(/failed to bind/i);
    server.close();
  });

  it('findPackageVersion returns semver-like string', () => {
    const v = _findPackageVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});
