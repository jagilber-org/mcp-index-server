# Playwright UI Drift Baseline

## Purpose

Baseline structural + visual regression guard for the admin dashboard. Focus is on catching unintended layout or content regressions (e.g., missing System Health, lost semantic summaries, instruction list structure changes).

## Test Tags

Tests containing `@baseline` tag participate in drift detection commands:

- `npm run pw:baseline` – update snapshots (golden refresh)
- `npm run pw:drift` – compare against existing snapshots (CI usage)

## Snapshot Policy

- Only stable, high‑signal regions captured (system health card, instruction list)
- Avoids full‑page snapshot noise (timestamps, dynamic metrics variance)
- Spark line variability minimized with short delay (≈1.2s) before capture

## Workflow

1. Start server with dashboard enabled (default port 8787):
   - Example: `MCP_DASHBOARD=1 npm run start` (adapt to your start script)
2. Install browsers (first time): `npm run pw:init`
3. Capture / refresh baseline: `npm run pw:baseline`
4. Validate drift: `npm run pw:drift`

## Environment Overrides

- `DASHBOARD_PORT` – target non-default port
- `PLAYWRIGHT_BASE_URL` – override full base URL

## Adding New Regions

Keep snapshots: deterministic, semantically meaningful, low churn. Prefer narrow component locators over full page.

## Maintenance Triggers

Refresh snapshots when intentionally modifying:

- Instruction list row structure or CSS class names
- System Health card layout or chart styling
- Semantic summary rendering logic

Do NOT refresh simply for unrelated content changes—investigate diffs first.
