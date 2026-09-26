import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.SESLY_SMOKE_URL ?? 'http://localhost:3912';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
try {
  await page.addInitScript(() => localStorage.setItem('sesly.setup.complete.v1', '1'));
  await page.goto(baseUrl + '/#/stories');
  const compactSidebar = page.locator('[data-slot=compact-main-sidebar]');
  await compactSidebar.waitFor();
  const nav = compactSidebar.getByRole('navigation', { name: 'Workspaces', exact: true });
  await nav.waitFor();
  await nav.evaluate((element) => {
    window.originalWorkspaceNavigation = element;
  });
  for (const path of [
    '/stories',
    '/audiobook',
    '/projects',
    '/tools',
    '/batch',
    '/gallery',
    '/dub',
    '/design',
    '/transcriptions',
  ]) {
    await page.goto(baseUrl + '/#' + path);
    await page.waitForURL(`**/#${path}`);
    assert.equal(await nav.count(), 1, `Navigation disappeared on ${path}`);
    assert.ok(
      await nav.evaluate((el) => el === window.originalWorkspaceNavigation),
      `Sidebar remounted on ${path}`,
    );
    const bounds = await compactSidebar.boundingBox();
    assert.equal(Math.round(bounds.x), 0);
    assert.equal(Math.round(bounds.width), 48);
    assert.equal(await nav.locator('[aria-current=page]').count(), 1);
    assert.equal(await page.locator('main h1').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await nav.getByRole('link', { name: 'Clone', exact: true }).click();
  await page.waitForURL('**/#/clone');
  await compactSidebar.waitFor({ state: 'detached' });
  const expandedSidebar = page.locator('.brand-sidebar').filter({ hasText: 'Saved voices' });
  await expandedSidebar.waitFor();
  assert.ok((await expandedSidebar.boundingBox()).width >= 220);
  assert.equal(
    await expandedSidebar.getByRole('navigation', { name: 'Workspaces', exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, [], `Workspace routes emitted renderer errors:\n${errors.join('\n')}`);
  console.log(
    'Shared compact rail stays mounted across all nine secondary workspaces and Clone restores the full library.',
  );
} finally {
  await browser.close();
}
