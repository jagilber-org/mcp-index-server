import { describe, it, expect } from 'vitest';
import { _parseArgs, _findPackageVersion } from '../server/index';

describe('server/index arg parsing & version', () => {
  it('parses dashboard flags and help', () => {
    const cfg = _parseArgs(['node','index','--dashboard','--dashboard-port=9999','--dashboard-host=localhost','--dashboard-tries=2']);
    expect(cfg.dashboard).toBe(true);
    expect(cfg.dashboardPort).toBe(9999);
    expect(cfg.dashboardHost).toBe('localhost');
    expect(cfg.maxPortTries).toBe(2);
  });
  it('finds package version', () => {
    const v = _findPackageVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});
