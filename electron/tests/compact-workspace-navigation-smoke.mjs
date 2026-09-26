import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.addInitScript(() => localStorage.setItem('sesly.setup.complete.v1', '1'));
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const fixtures = {
        '/api/health': { status: 'ok' },
        '/api/setup/status': { ready: true },
        '/api/models/install/status': { jobs: [] },
        '/api/workers/target': {
          target: 'local',
          op: 'tts',
          active: { remote: false, label: 'Local', reason: '' },
          targets: [],
          remote_operations: [],
        },
        '/api/profiles': [],
        '/api/history': [],
        '/api/projects': [],
        '/api/export/history': [],
        '/api/longform/jobs': { jobs: [] },
      };
      return path in fixtures
        ? route.fulfill({ json: fixtures[path] })
        : route.fulfill({ status: 404, json: { detail: 'Not mocked' } });
    },
  );
  const routes = [
    ['Voice', 'Clone', '/clone'],
    ['Voice', 'Design', '/design'],
    ['Voice', 'Saved', '/personas'],
    ['Voice', 'Gallery', '/gallery'],
    ['Stories', 'Stories', '/stories'],
    ['Stories', 'Audiobook', '/audiobook'],
    ['Dubbing', 'Dub', '/dub'],
    ['Dubbing', 'Batch Dub', '/batch'],
  ];
  for (const [group, item, path] of routes) {
    await page.goto((process.env.SESLY_UI_URL || 'http://localhost:3928') + '/#/design');
    const rail = page.locator('[data-slot=compact-main-sidebar]');
    await rail.waitFor();
    await rail.getByRole('button', { name: group, exact: true }).click();
    const link = page.getByRole('link', { name: item, exact: true });
    await link.waitFor();
    if (process.env.SESLY_SCREENSHOT && item === 'Clone')
      await page.screenshot({ path: process.env.SESLY_SCREENSHOT, animations: 'disabled' });
    await link.click();
    await page.waitForURL('**/#' + path, { timeout: 3000 });
  }
  await page.goto((process.env.SESLY_UI_URL || 'http://localhost:3928') + '/#/design');
  const rail = page.locator('[data-slot=compact-main-sidebar]');
  await rail.waitFor();
  const voice = rail.getByRole('button', { name: 'Voice', exact: true });
  await page.mouse.move(1100, 400);
  await voice.hover();
  const clone = page.getByRole('link', { name: 'Clone', exact: true });
  await clone.waitFor();
  assert.equal(await voice.getAttribute('aria-expanded'), 'true');
  await clone.hover();
  await page.waitForTimeout(250);
  assert.equal(await clone.isVisible(), true, 'flyout should remain open while moving into it');
  await page.mouse.move(1100, 400);
  await clone.waitFor({ state: 'hidden' });
  await voice.focus();
  await page.keyboard.press('Enter');
  await clone.waitFor();
  await page.keyboard.press('Escape');
  await clone.waitFor({ state: 'hidden' });
  assert.equal(await voice.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  await clone.waitFor();
  assert.equal(await clone.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('ArrowLeft');
  await clone.waitFor({ state: 'hidden' });
  assert.equal(await voice.evaluate((element) => element === document.activeElement), true);
  await voice.dblclick();
  await rail.waitFor({ state: 'hidden' });
  assert.equal((await page.getByRole('button', { name: 'Close', exact: true }).count()) > 0, true);
  console.log('PASS: compact flyout hover transit, dismissal, and keyboard access');
  console.log(`PASS: ${routes.length} compact navigation destinations`);
} finally {
  await browser.close();
}
