import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  const actions = [];
  let state = 'idle';
  await page.route('**/api/media-tools/status', (route) =>
    route.fulfill({
      json: {
        tools: {
          ffmpeg: { ok: true, version: 'fixture', origin: 'system' },
          ffprobe: { ok: state === 'done', origin: 'bundled' },
          ytdlp: { version: 'fixture', overlay_version: null },
        },
        ops: { acquire: { state, progress: 0.5 } },
      },
    }),
  );
  await page.route('**/api/media-tools/acquire', (route) => {
    actions.push('acquire');
    state = 'running';
    return route.fulfill({ json: { state } });
  });
  await page.route('**/api/media-tools/ffmpeg/use-system', (route) => {
    actions.push('system');
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(
    (process.env.SESLY_UI_URL || 'http://localhost:3902') + '/#/settings/media',
  );
  await page.getByText('Unavailable', { exact: true }).waitFor();
  assert.deepEqual(actions, []);
  await page.getByRole('button', { name: 'Update bundled build', exact: true }).click();
  await page.getByRole('button', { name: /50%/ }).waitFor();
  assert(
    await page.getByRole('button', { name: 'Use system copy', exact: true }).first().isDisabled(),
  );
  state = 'done';
  await page.getByRole('status').filter({ hasText: 'Available' }).waitFor();
  await page.getByRole('button', { name: 'Use system copy', exact: true }).first().click();
  await page.waitForTimeout(100);
  assert.deepEqual(actions, ['acquire', 'system']);
  console.log('PASS: media-tool status, explicit installer, progress lock and system selection');
} finally {
  await browser.close();
}
