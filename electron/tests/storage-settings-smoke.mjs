import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const strings = JSON.parse(
  await readFile(new URL('../src/renderer/src/i18n/locales/en.json', import.meta.url), 'utf8'),
);
const t = (key) => key.split('.').reduce((value, part) => value[part], strings);
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let clears = 0,
    rescans = 0,
    partial = false;
  const opens = [];
  const report = {
    volumes: [
      {
        path: 'C:/',
        total_bytes: 100 * 1024 ** 3,
        used_bytes: 96 * 1024 ** 3,
        free_bytes: 4 * 1024 ** 3,
        used_percent: 96,
        roots: ['data'],
      },
    ],
    warnings: [
      { kind: 'low_disk', severity: 'critical', path: 'C:/', free_gb: 4, min_free_gb: 10 },
    ],
    categories: [
      {
        id: 'hf_cache',
        path: 'C:/models',
        bytes: 12 * 1024 ** 3,
        exists: true,
        complete: false,
        items: [{ name: 'Org/FixtureModel', bytes: 12 * 1024 ** 3 }],
      },
      {
        id: 'data',
        path: 'C:/data',
        bytes: 1024,
        exists: true,
        children: [{ id: 'logs', bytes: 1024, complete: true }],
      },
      { id: 'engine_venvs', path: 'C:/engines', bytes: 4096, exists: true, items: [] },
      { id: 'temp', path: 'C:/temp', bytes: 1024, exists: true, items: [] },
    ],
  };
  await page.route('**/api/api/settings/storage*', (route) => {
    if (route.request().url().includes('refresh=1')) rescans++;
    return route.fulfill({ json: report });
  });
  await page.route('**/api/api/settings/storage/temp/clear', (route) => {
    clears++;
    return route.fulfill({
      json: {
        freed_bytes: 1024,
        errors: partial ? [{ path: 'locked', error: 'Private diagnostic' }] : [],
      },
    });
  });
  await page.route('**/api/api/settings/db-backup', (route) =>
    route.fulfill({
      json: {
        available: true,
        latest: { path: 'C:/data/database.backup', created_at: 1750000000, size_bytes: 1024 },
      },
    }),
  );
  await page.route('**/api/api/settings/history-retention', (route) =>
    route.fulfill({ json: { cap: 200, default: 200 } }),
  );
  await page.route('**/api/export/reveal', (route) => {
    opens.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  const base = process.env.SESLY_UI_URL || 'http://localhost:3902';
  await page.goto(base + '/#/settings/general');
  await page.getByRole('link', { name: t('settings.storage'), exact: true }).click();
  await page.waitForURL('**/#/settings/storage');
  await page.getByRole('meter', { name: 'C:/', exact: true }).waitFor();
  assert.equal(await page.getByRole('meter').getAttribute('aria-valuenow'), '96');
  await page.getByText(t('settings.storage_partial'), { exact: true }).waitFor();
  assert.equal(clears, 0);
  await page
    .locator('summary')
    .filter({ hasText: t('settings.storage_top_models') })
    .click();
  await page.getByText('Org/FixtureModel', { exact: true }).waitFor();
  const opened = page.waitForResponse((response) => response.url().endsWith('/export/reveal'));
  await page
    .getByRole('button', { name: t('settings.storage_open_folder'), exact: true })
    .first()
    .click();
  await opened;
  assert.deepEqual(opens, [{ path: 'C:/models' }]);
  const clear = page.getByRole('button', { name: t('settings.storage_clear_temp'), exact: true });
  await clear.click();
  await page.getByRole('button', { name: t('common.cancel'), exact: true }).click();
  assert.equal(clears, 0);
  await clear.click();
  await page.getByRole('button', { name: t('common.confirm'), exact: true }).click();
  await page.getByRole('status').waitFor();
  assert.equal(clears, 1);
  assert.equal(rescans, 1);
  partial = true;
  await clear.click();
  await page.getByRole('button', { name: t('common.confirm'), exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: t('common.error') })
    .waitFor();
  assert.equal(clears, 2);
  assert.equal(await page.getByRole('status').count(), 0);
  assert.equal(await page.getByText('Private diagnostic').count(), 0);
  await page.getByText('C:/data/database.backup', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: storage breakdown, disk warnings, partial scans, folder reveal, confirmed cleanup, partial failure and backup status',
  );
} finally {
  await browser.close();
}
