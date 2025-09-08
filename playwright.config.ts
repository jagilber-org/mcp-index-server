import { defineConfig, devices } from '@playwright/test';

// Base Playwright configuration for UI drift detection.
// Assumptions:
// 1. Dashboard server started prior to tests (MCP_DASHBOARD=1 or equivalent CLI flag)
// 2. Default dashboard port 8787 (override with DASHBOARD_PORT env if needed)
// 3. Tests focus on structural + snapshot stability (lightweight, fast)

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '8787';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${DASHBOARD_PORT}`;

export default defineConfig({
  testDir: 'tests/playwright',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  metadata: {
    purpose: 'ui-drift-detection',
    baseURL
  }
});
