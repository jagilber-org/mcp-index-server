import { describe, it, expect, vi } from 'vitest';

describe('featureFlags negative/override paths', () => {
  it('env var disables flag even if file enables', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'flags-neg-'));
    const file = path.join(dir,'flags.json');
    fs.writeFileSync(file, JSON.stringify({ response_envelope_v1: true }));
    vi.resetModules();
    process.env.MCP_FLAGS_FILE = file;
    process.env.MCP_FLAG_RESPONSE_ENVELOPE_V1 = '0';
    const { flagEnabled } = await import('../services/featureFlags');
    expect(flagEnabled('response_envelope_v1')).toBe(false);
  });
  it('handles missing flags file gracefully', async () => {
    vi.resetModules();
    delete process.env.MCP_FLAGS_FILE;
    delete process.env.MCP_FLAG_RESPONSE_ENVELOPE_V1;
    const { flagEnabled } = await import('../services/featureFlags');
    expect(flagEnabled('response_envelope_v1')).toBe(false);
  });
});
