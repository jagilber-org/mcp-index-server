import { test, expect } from '@playwright/test';

// Tag: @baseline - used for drift detection runs
// Provides structural checks plus snapshot capture for key UI regions.
// Assumes dashboard already running at configured baseURL.

test.describe('Admin Dashboard Baseline @baseline', () => {
  test('loads admin page and navigates to instructions section', async ({ page }) => {
    await page.goto('/admin');

    // Overview (default) should show system health (use more specific selector to avoid strict mode violation)
    await expect(page.locator('.admin-card .card-title:has-text("System Health")')).toBeVisible();
    await expect(page.locator('#system-health')).toBeVisible();

    // Switch to instructions section via nav button
    await page.click("button:has-text('Instructions')");
    await page.waitForSelector('#instructions-list', { timeout: 15000 });
    // Poll for rows since loadInstructions() does async fetch
    await page.waitForFunction(() => {
      const list = document.querySelector('#instructions-list');
      return !!list && !!list.querySelector('.session-item');
    }, { timeout: 15000 });
    await expect(page.locator('#instructions-list')).toBeVisible();
  });

  test('instruction list contains semantic summaries (sampled)', async ({ page }) => {
    await page.goto('/admin');
  await page.click("button:has-text('Instructions')");
  const rows = page.locator('#instructions-list .session-item');
    try {
      await rows.first().waitFor({ timeout: 15000 });
    } catch {
      // Fallback: force reload once if empty - target refresh inside instructions section only
      await page.click('#instructions-section button:has-text("Refresh")');
      await rows.first().waitFor({ timeout: 10000 });
    }

    const count = await rows.count();
    const sampleSize = Math.min(count, 5);

    for (let i = 0; i < sampleSize; i++) {
      const row = rows.nth(i);
      const summaryVal = row.locator('.stat-row:has(.stat-label:has-text("Summary")) .stat-value');
      await expect(summaryVal, `Row ${i} missing summary stat row`).toBeVisible();
      const text = (await summaryVal.innerText()).trim();
      expect(text.length, `Row ${i} summary empty`).toBeGreaterThan(0);
    }
  });

  test('capture visual snapshot of system health card', async ({ page }) => {
  await page.goto('/admin');
  const card = page.locator('#system-health');
  await expect(card).toBeVisible();
  await page.waitForTimeout(1500); // allow spark charts to populate
  // Minor pixel drift (sparks timing) acceptable; rely on snapshot update process
  expect(await card.screenshot()).toMatchSnapshot('system-health-card.png');
  });

  test('capture visual snapshot of instruction list region', async ({ page }) => {
  await page.goto('/admin');
  await page.click("button:has-text('Instructions')");
  const list = page.locator('#instructions-list');
  await expect(list).toBeVisible();
    try {
      await list.locator('.session-item').first().waitFor({ timeout: 15000 });
    } catch {
      await page.click('#instructions-section button:has-text("Refresh")');
      await list.locator('.session-item').first().waitFor({ timeout: 10000 });
    }
    expect(await list.screenshot()).toMatchSnapshot('instructions-list.png');
  });
});
