import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { wave } from './test-wave.mjs';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const item = {
    id: 'warm',
    name: 'Warm narrator',
    instruct: 'Warm, clear narration',
    language: 'English',
    facets: {},
    attrs: {},
  };
  let uses = 0;
  let previews = 0;
  let searches = [];
  await page.route('**/api/archetypes/categories', (route) =>
    route.fulfill({ json: [{ id: 'narration', name: 'Narration' }] }),
  );
  await page.route('**/api/archetypes?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    searches.push(params);
    const offset = Number(params.get('offset'));
    return route.fulfill({
      json: {
        items: [
          { ...item, id: offset ? 'second' : 'warm', name: offset ? 'Second narrator' : item.name },
        ],
        total: 2,
        offset,
        limit: 60,
      },
    });
  });
  await page.route('**/api/archetypes/warm/preview', (route) => {
    previews++;
    return route.fulfill({ contentType: 'audio/wav', body: wave });
  });
  await page.route('**/api/archetypes/warm/use', (route) => {
    uses++;
    return route.fulfill({ json: { profile_id: 'saved', name: item.name } });
  });
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: [
        {
          id: 'saved',
          name: item.name,
          kind: 'design',
          seed: 1234,
          language: 'English',
          vd_states: '{"Gender":"Female"}',
        },
      ],
    }),
  );
  const base = process.env.SESLY_UI_URL || 'http://localhost:3902';
  await page.goto(base + '/#/gallery');
  await page.getByRole('heading', { name: item.name }).waitFor();
  assert.equal(uses, 0);
  assert.equal(previews, 0);
  await page.getByRole('button', { name: 'Narration', exact: true }).click();
  await page.waitForTimeout(250);
  assert(searches.some((params) => params.get('use_case') === 'narration'));
  await page.getByRole('searchbox').fill('Warm');
  await page.waitForTimeout(400);
  assert(searches.some((params) => params.get('q') === 'Warm'));
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await page.getByRole('heading', { name: 'Second narrator' }).waitFor();
  await page.getByRole('button', { name: 'Favorite: Second narrator', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await page.getByRole('heading', { name: 'Second narrator' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Warm narrator', exact: true }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await page.getByRole('heading', { name: 'Second narrator' }).waitFor();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Gender' }).click();
  await page.getByRole('button', { name: 'female', exact: true }).click();
  await page.waitForTimeout(200);
  assert(searches.some((params) => params.get('gender') === 'female'));
  await page.getByRole('button', { name: 'Reset', exact: true }).click();

  await page.getByRole('button', { name: 'Preview voice', exact: true }).first().click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('audio')].some((audio) => !audio.paused && audio.currentTime > 0),
  );
  await page.getByRole('button', { name: 'Use voice', exact: true }).first().click();
  await page.waitForURL('**/#/design');
  assert.equal(uses, 1);
  assert.equal(await page.getByRole('spinbutton').inputValue(), '1234');
  await page.goto(base + '/#/gallery');
  await page.getByRole('heading', { name: item.name }).waitFor();
  await page.route('**/api/archetypes/warm/preview', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await page.getByRole('button', { name: 'Preview voice', exact: true }).first().click();
  await page.getByRole('button', { name: 'Playback unavailable', exact: true }).waitFor();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route('**/api/archetypes/warm/use', async (route) => {
    started = true;
    await pending;
    await route.fulfill({ json: { profile_id: 'saved', name: item.name } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Use voice', exact: true }).first().click();
  await page.waitForTimeout(100);
  assert(started);
  await page.locator('header a').click();
  release();
  await page.waitForTimeout(250);
  assert(
    page.url().endsWith('/#/clone'),
    'Late save must not navigate away from the chosen workspace',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: gallery categories, search, pagination, native audio preview and design-profile handoff',
  );
} finally {
  await browser.close();
}
