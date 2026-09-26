import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('sesly.setup.complete.v1', '1'));
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const path = new URL(route.request().url()).pathname;
    const fixtures = {
      '/api/health': { status: 'ok' },
      '/api/setup/status': { ready: true },
      '/api/models/install/status': { jobs: [] },
      '/api/workers/target': { target: 'local', op: 'tts', active: { remote: false, label: 'Local', reason: '' }, targets: [], remote_operations: [] },
    };
    return path in fixtures ? route.fulfill({ json: fixtures[path] }) : route.fulfill({ status: 404, json: { detail: 'Not mocked' } });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const stored = {
    id: 'legacy',
    name: 'Legacy project',
    state: {
      dubJobId: 'fixture',
      dubFilename: 'clip.wav',
      inputType: 'audio',
      dubLang: 'Spanish',
      dubStep: 'editing',
      dubSegments: [{ id: 1, start: 0, end: 2, text: 'Legacy sentence' }],
      preserveBg: false,
    },
  };
  let row = stored;
  let writes = 0;
  let renames = 0;
  await page.addInitScript(() => {
    localStorage.setItem(
      'omni_transcriptions',
      JSON.stringify([
        {
          id: 42,
          text: 'Fixture transcript',
          language: 'English',
          duration_s: 3,
          segments: [],
          timestamp: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: [
        {
          id: 'voice-1',
          name: 'Library voice',
          kind: 'clone',
          ref_audio_path: 'voice.wav',
          created_at: 1,
        },
      ],
    }),
  );
  await page.route('**/api/history', (route) =>
    route.fulfill({
      json: [
        {
          id: 'take-1',
          text: 'Library take',
          mode: 'clone',
          audio_path: 'take.wav',
          created_at: 2,
        },
      ],
    }),
  );
  await page.route('**/api/export/history', (route) =>
    route.fulfill({
      json: [
        {
          id: 'export-1',
          filename: 'finished.wav',
          destination_path: 'C:\\exports\\finished.wav',
          mode: 'clone',
          created_at: 3,
        },
      ],
    }),
  );
  await page.route('**/api/longform/jobs**', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/projects**', (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      renames++;
      row = { ...row, name: route.request().postDataJSON().name };
      return route.fulfill({ json: row });
    }
    if (method === 'DELETE') {
      row = null;
      return route.fulfill({ json: { deleted: 'legacy' } });
    }
    if (method === 'PUT') {
      writes++;
      row = { ...route.request().postDataJSON(), id: 'legacy' };
      return route.fulfill({ json: row });
    }
    return route.fulfill({
      json: route.request().url().endsWith('/projects') ? (row ? [row] : []) : row,
    });
  });
  await page.goto((process.env.SESLY_UI_URL || 'http://localhost:3902') + '/#/projects');
  const filters = page.locator('[data-slot=secondary-sidebar]');
  await filters.getByRole('button', { name: 'Voice Profiles 1', exact: true }).click();
  await page.locator('main').getByRole('heading', { name: 'Library voice', exact: true }).waitFor();
  await filters.getByRole('button', { name: 'Transcripts 1', exact: true }).click();
  await page.getByText('Fixture transcript', { exact: true }).waitFor();
  await filters.getByRole('button', { name: 'All 5', exact: true }).click();
  await page.getByRole('button', { name: 'Legacy project', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(page.url().endsWith('/projects'));
  await page.getByRole('button', { name: 'Legacy project', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForURL('**/#/dub');
  await page
    .getByRole('navigation', { name: 'Workspaces' })
    .getByRole('link', { name: 'Projects', exact: true })
    .click();
  await page.locator('#project-name').fill('Renamed project');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Renamed project', exact: true }).waitFor();
  assert.equal(writes, 1);
  assert.equal(row.state.preserveBg, false);
  await page.reload();
  assert.equal(await page.locator('#project-name').inputValue(), 'Renamed project');
  await page.getByRole('button', { name: 'Rename Renamed project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Library renamed');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('button', { name: 'Library renamed', exact: true }).waitFor();
  assert.equal(renames, 1);
  assert.equal(writes, 1);
  assert.equal(row.state.preserveBg, false);
  assert.equal(await page.locator('#project-name').inputValue(), 'Library renamed');
  await page.getByRole('button', { name: 'Delete Library renamed', exact: true }).click();
  assert(row);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height);
  if (process.env.SESLY_SCREENSHOT) await page.screenshot({ path: process.env.SESLY_SCREENSHOT });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('button', { name: 'Library renamed', exact: true })
    .waitFor({ state: 'detached' });
  await page.locator('main').getByRole('heading', { name: 'Library voice', exact: true }).waitFor();
  assert.equal(row, null);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: legacy project open/cancel, save, preserved options, reload and confirmed deletion',
  );
} finally {
  await browser.close();
}
