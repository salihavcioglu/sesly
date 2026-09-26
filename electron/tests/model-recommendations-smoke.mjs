import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const strings = JSON.parse(
  await readFile(new URL('../src/renderer/src/i18n/locales/en.json', import.meta.url), 'utf8'),
);
const t = (key) => key.split('.').reduce((value, part) => value[part], strings);
const device = 'Windows x64 + CUDA';
const requested = [];
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/models/install/status', (route) =>
    route.fulfill({ json: { jobs: [] } }),
  );
  await page.route('**/api/models/install', async (route) => {
    requested.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: 'started' } });
  });
  await page.route('**/api/models', (route) =>
    route.fulfill({ json: { target: 'gpu2', models: [], disk_free_gb: 2.5 } }),
  );
  await page.route('**/api/setup/recommendations', (route) =>
    route.fulfill({
      json: {
        target: 'gpu2',
        device: { label: device },
        models: [
          {
            repo_id: 'k2-fsa/OmniVoice',
            label: 'Sesly TTS',
            role: 'TTS',
            size_gb: 2.4,
            required: true,
            installed: false,
          },
          {
            repo_id: 'Systran/faster-whisper-large-v3',
            label: 'Whisper large-v3',
            role: 'ASR',
            size_gb: 2.9,
            required: false,
            installed: false,
          },
        ],
        download_gb_remaining: 5.3,
        total_gb: 5.3,
        all_installed: false,
      },
    }),
  );

  const base = process.env.SESLY_UI_URL || 'http://localhost:3902';
  await page.goto(base + '/#/settings/models');
  await page
    .getByRole('heading', { name: t('models.reco_for').replace('{{device}}', device) })
    .waitFor();
  await page.getByRole('alert').filter({ hasText: '5.3' }).waitFor();
  assert.equal(await page.getByText('Sesly TTS', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Whisper large-v3', { exact: true }).count(), 1);

  await page.setViewportSize({ width: 640, height: 720 });
  const settingsWidth = await page
    .locator('aside')
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(settingsWidth <= 208, `compact Settings navigation stayed ${settingsWidth}px wide`);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'compact Models settings overflowed horizontally',
  );

  await page
    .getByRole('button', {
      name: t('models.reco_install_one').replace('{{label}}', 'Sesly TTS'),
    })
    .click();
  await page.waitForFunction(() => document.body.textContent?.includes('Sesly TTS'));
  assert.deepEqual(requested, [{ repo_id: 'k2-fsa/OmniVoice', target: 'gpu2' }]);
  assert.deepEqual(errors, []);
  console.log('PASS: device recommendations, low-disk warning, and scoped install action');
} finally {
  await browser.close();
}
