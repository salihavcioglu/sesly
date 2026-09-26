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
  let provider = 'unknown';
  let watermark = { audioseal_available: true, invisible_enabled: true };
  let analytics = { available: true, opted_in: false, enabled: false };
  let retention = { cap: 200, default: 200 };
  const writes = [];
  let reject = false;
  await page.route('**/api/system/info', (route) =>
    route.fulfill({ json: { translate_provider: provider } }),
  );
  await page.route('**/api/watermark/status', (route) => route.fulfill({ json: watermark }));
  await page.route('**/api/watermark/settings?*', (route) => {
    writes.push('watermark');
    watermark.invisible_enabled =
      new URL(route.request().url()).searchParams.get('invisible') === 'true';
    return route.fulfill({ json: watermark });
  });
  await page.route('**/api/api/settings/analytics', (route) => {
    if (route.request().method() === 'PUT') {
      writes.push('analytics');
      if (reject) return route.fulfill({ status: 500, json: { detail: 'Private diagnostic' } });
      analytics = {
        ...analytics,
        enabled: route.request().postDataJSON().enabled,
        opted_in: route.request().postDataJSON().enabled,
      };
    }
    return route.fulfill({ json: analytics });
  });
  await page.route('**/api/api/settings/history-retention', (route) => {
    if (route.request().method() === 'PUT') {
      writes.push('retention');
      retention = { ...retention, ...route.request().postDataJSON() };
    }
    return route.fulfill({ json: retention });
  });
  const base = process.env.SESLY_UI_URL || 'http://localhost:3902';
  await page.goto(base + '/#/settings/general');
  await page.getByRole('link', { name: t('settings.privacy'), exact: true }).click();
  await page.waitForURL('**/#/settings/privacy');
  await page.getByText(t('privacy.translator_unknown'), { exact: true }).waitFor();
  assert.equal(await page.getByText(t('privacy.translator_offline'), { exact: true }).count(), 0);
  assert.deepEqual(writes, []);
  const mark = page.getByRole('switch', { name: t('privacy.watermark_title'), exact: true });
  await mark.click();
  await mark.and(page.locator('[aria-checked="false"]')).waitFor();
  assert.equal(watermark.invisible_enabled, false);
  const consent = page.getByRole('switch', { name: t('privacy.analytics_title'), exact: true });
  await consent.click();
  await consent.and(page.locator('[aria-checked="true"]')).waitFor();
  assert.equal(analytics.opted_in, true);
  reject = true;
  await consent.click();
  await page.getByRole('alert').waitFor();
  assert.equal(await consent.getAttribute('aria-checked'), 'true');
  assert.equal(await page.getByText('Private diagnostic').count(), 0);
  const cap = page.getByRole('spinbutton', {
    name: t('settings.history_retention_cap'),
    exact: true,
  });
  await cap.fill('100');
  await cap.press('Enter');
  await page.getByRole('button', { name: t('common.confirm'), exact: true }).waitFor();
  assert.equal(retention.cap, 200);
  await page.getByRole('button', { name: t('common.cancel'), exact: true }).click();
  assert.equal(retention.cap, 200);
  await cap.press('Enter');
  await page.getByRole('button', { name: t('common.confirm'), exact: true }).click();
  await page.getByRole('status').waitFor();
  assert.equal(retention.cap, 100);
  await cap.fill('0');
  await cap.press('Enter');
  await page.getByRole('status').waitFor();
  assert.equal(retention.cap, 0);
  provider = 'nllb';
  watermark.audioseal_available = false;
  analytics.available = false;
  await page.reload();
  await page.getByText(t('privacy.translator_offline'), { exact: true }).waitFor();
  await mark.waitFor({ state: 'detached' });
  await consent.waitFor({ state: 'detached' });
  assert.equal(await cap.inputValue(), '0');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: privacy status, explicit analytics consent, watermark settings, failed saves, retention confirmation and unlimited retention',
  );
} finally {
  await browser.close();
}
