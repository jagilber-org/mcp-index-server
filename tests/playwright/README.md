# Playwright UI Drift Baseline (Full Suite)

## Purpose

Comprehensive structural + multi-browser visual regression guard for the admin dashboard. Detects layout, content, and cross-engine rendering regressions (e.g., missing System Health, lost semantic summaries, inconsistent list rendering).

## Test Tags

Tests containing `@baseline` tag participate in drift detection commands:

- `npm run pw:baseline` – update snapshots (golden refresh)
- `npm run pw:drift` – compare against existing snapshots (CI usage)

## Snapshot Policy

- High-signal regions: system health card, instruction list
- Cross-browser naming pattern: `<browser>-<region>.png`
- Dynamic variance reduced with small settle delay (≈1.5s)
- Thresholds configurable: `DRIFT_MAX_DIFF_RATIO` (default 0.002), `DRIFT_MAX_DIFF_PIXELS` (default 250)

## Workflow

1. Install browsers (first run): `npm run pw:init`
2. Refresh baseline (all browsers): `npm run pw:baseline`
3. Drift check locally (all configured browsers): `npm run pw:drift`
4. Generate drift report (JSON + markdown): `npm run pw:drift:report`
5. CI optimized run (chromium + firefox + report): `npm run pw:drift:ci`

## Environment Overrides

- `DASHBOARD_PORT` – target non-default port
- `PLAYWRIGHT_BASE_URL` – override full base URL
- `DRIFT_BROWSERS` – comma list subset of browsers (e.g. `chromium,firefox`)
- `DRIFT_MAX_DIFF_RATIO` – snapshot diff tolerance ratio
- `DRIFT_MAX_DIFF_PIXELS` – absolute pixel diff ceiling

## Adding New Regions

1. Identify stable DOM container (#id or data-test attr).
2. Add test with: small settle wait, region screenshot, `toMatchSnapshot` using browserName prefix.
3. Justify region (signal > noise) in commit message.
4. Run `npm run pw:baseline` to produce new golden images.

## Maintenance Triggers

Refresh snapshots when intentionally modifying:

- Instruction list row structure / CSS classes
- System Health card layout or chart styles
- Semantic summary rendering logic

Investigate before updating if diff cause is unclear (avoid normalizing accidental regressions).

## Drift Report Artifacts

`scripts/generate-drift-report.mjs` emits:

- `playwright-report/drift-report.json` – machine summary
- `playwright-report/drift-report.md` – human-readable list & perf annotations

Integrate into CI by uploading both plus the standard Playwright HTML report.
