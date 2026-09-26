import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.addInitScript(() => {
  localStorage.setItem('sesly.setup.complete.v1', '1');
});
const broken = process.env.SESLY_TEST_BROKEN_FALLBACK === '1';
let canonical = 0;
let fallback = 0;
await page.route('**/api/community/items/feat_00_the_librarian/preview*', async (route) => {
  const local = new URL(route.request().url()).searchParams.get('local') === 'true';
  if (local) fallback++;
  else canonical++;
  await route.fulfill({
    status: 200,
    contentType: 'audio/wav',
    body:
      local && !broken
        ? readFileSync(
            new URL(
              '../../backend/assets/samples/dictation/en_conversational.wav',
              import.meta.url,
            ),
          )
        : Buffer.from('invalid cached audio'),
  });
});
try {
  const base = process.env.SESLY_UI_URL || 'http://localhost:3912';
  await page.goto(base + '/#/gallery');
  await page.getByRole('button', { name: 'Community', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'The Librarian', exact: true }) });
  await card.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await card
    .getByRole('button', { name: broken ? 'Playback unavailable' : 'Pause', exact: true })
    .waitFor({ timeout: 5000 });
  assert.equal(canonical, 1);
  assert.equal(fallback, 1);
  if (!broken) await card.getByRole('button', { name: 'Pause', exact: true }).click();
  console.log(
    broken
      ? 'Failed local preview stops without a retry loop.'
      : 'Malformed gallery audio recovers once through local preview.',
  );
} finally {
  await browser.close();
}
