import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const backend = process.env.SESLY_BACKEND_URL || 'http://127.0.0.1:3900';
const renderer = process.env.SESLY_UI_URL || 'http://127.0.0.1:3912';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const profileName = 'Golden retriever portrait';
let profileId;

try {
  await page.addInitScript(() => {
    localStorage.setItem('sesly.setup.complete.v1', '1');
    localStorage.setItem('sesly.locale', 'en');
  });
  const created = await page.request.post(`${backend}/profiles`, {
    multipart: {
      name: profileName,
      kind: 'design',
      instruct: 'warm and friendly',
      seed: '1234',
      vd_states: '{}',
      language: 'English',
    },
  });
  assert.equal(created.status(), 200);
  profileId = (await created.json()).id;

  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${renderer}/#/personas`);
  const row = page.locator('li').filter({
    has: page.getByRole('button', { name: profileName, exact: true }),
  });
  await row.waitFor();
  await row.hover();
  await row.getByRole('button', { name: 'Edit voice profile', exact: true }).click();

  const pane = page.getByRole('complementary', { name: 'Edit voice profile', exact: true });
  const searched = page.waitForResponse(
    (response) =>
      response.url().includes('/api/profile-images/search') &&
      response.request().method() === 'GET',
    { timeout: 90_000 },
  );
  await pane.getByRole('button', { name: 'Search images', exact: true }).click();
  const response = await searched;
  assert.equal(response.status(), 200);

  const portraits = pane.locator('button:has(img[src^="data:image/jpeg;base64,"])');
  await portraits.first().waitFor({ timeout: 15_000 });
  assert.equal(await portraits.count(), 5);
  for (let index = 0; index < 5; index++) {
    assert.ok((await portraits.nth(index).getAttribute('aria-label'))?.trim());
  }

  const imageSaved = page.waitForResponse(
    (candidate) =>
      candidate.url().includes(`/api/profiles/${encodeURIComponent(profileId)}/image`) &&
      candidate.request().method() === 'PUT',
  );
  await portraits.first().click();
  assert.equal((await imageSaved).status(), 200);
  await pane
    .locator(`img[src*="/api/profiles/${encodeURIComponent(profileId)}/image"]`)
    .first()
    .waitFor();

  const stored = await (await page.request.get(`${backend}/profiles/${profileId}`)).json();
  assert.match(stored.image_url, new RegExp(`/profiles/${profileId}/image\\?v=\\d+`));
  const image = await page.request.get(`${backend}${stored.image_url}`);
  assert.equal(image.status(), 200);
  assert.match(image.headers()['content-type'], /^image\/jpeg/);
  const bytes = await image.body();
  assert.ok(bytes.length > 500);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.deepEqual(failures, []);
  console.log('Profile portrait search returned five choices and persisted a normalized JPEG.');
} finally {
  if (profileId) await page.request.delete(`${backend}/profiles/${encodeURIComponent(profileId)}`);
  await browser.close();
}
