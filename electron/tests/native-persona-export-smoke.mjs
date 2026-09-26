import { _electron as electron } from 'playwright';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const folder = mkdtempSync(join(tmpdir(), 'sesly-native-persona-'));
const name = 'Native persona ' + Date.now();
const packagedExecutable = process.env.SESLY_PACKAGED_EXE?.trim();
const developmentExecutable = resolve(
  'electron/node_modules/electron/dist',
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron',
);
const profileDirectory = process.env.SESLY_TEST_PROFILE?.trim() || join(folder, 'profile');
const port = await reservePort();
let app;
let voice;
let profile;
try {
  app = await electron.launch({
    executablePath: packagedExecutable ? resolve(packagedExecutable) : developmentExecutable,
    args: [
      ...(packagedExecutable ? [] : [resolve('electron/out/main/index.js')]),
      '--user-data-dir=' + profileDirectory,
    ],
    env: {
      ...process.env,
      OMNIVOICE_PORT: String(port),
      ...(packagedExecutable ? {} : { ELECTRON_RENDERER_URL: '' }),
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await waitForBackendReady(port);
  const audio = readFileSync(resolve('backend/assets/samples/dictation/en_conversational.wav'));
  const created = await page.evaluate(
    async ({ sample, profileName }) => {
      const bytes = Uint8Array.from(atob(sample), (character) => character.charCodeAt(0));
      const body = new FormData();
      body.append('name', profileName);
      body.append('category', 'import');
      body.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'sample.wav');
      const uploaded = await fetch('/api/gallery/upload', { method: 'POST', body });
      if (!uploaded.ok)
        throw new Error(
          'Gallery upload failed: ' + uploaded.status + ' ' + (await uploaded.text()),
        );
      const voiceId = (await uploaded.json()).id;
      const saved = await fetch(
        '/api/gallery/voices/' +
          encodeURIComponent(voiceId) +
          '/save-as-profile?profile_name=' +
          encodeURIComponent(profileName),
        { method: 'POST' },
      );
      if (!saved.ok)
        throw new Error('Profile save failed: ' + saved.status + ' ' + (await saved.text()));
      return { voiceId, profileId: (await saved.json()).profile_id };
    },
    { sample: audio.toString('base64'), profileName: name },
  );
  voice = created.voiceId;
  profile = created.profileId;
  await page.evaluate(() => {
    window.localStorage.setItem('sesly.setup.complete.v1', '1');
    window.location.hash = '#/personas';
    window.location.reload();
  });
  await page.getByRole('heading', { name: 'Saved voices', exact: true }).waitFor();
  const declineAnalytics = page.getByRole('button', { name: 'No thanks', exact: true });
  if (
    await declineAnalytics
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false)
  )
    await declineAnalytics.click();
  const row = page
    .locator('li.py-3')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: 'Edit voice profile', exact: true }).click();
  const details = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Export persona' }) });
  await details.locator('summary').click();
  const exportPath = join(folder, 'voice.ovsvoice');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await details.getByRole('button', { name: 'Export persona', exact: true }).click();
  for (let i = 0; i < 100; i++) {
    if (existsSync(exportPath)) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(existsSync(exportPath), true);
  const manifest = await page.evaluate(async (bundle) => {
    const bytes = Uint8Array.from(atob(bundle), (character) => character.charCodeAt(0));
    const inspect = new FormData();
    inspect.append('file', new Blob([bytes]), 'voice.ovsvoice');
    const metadata = await fetch('/api/personas/inspect', { method: 'POST', body: inspect });
    if (!metadata.ok)
      throw new Error(
        'Persona inspection failed: ' + metadata.status + ' ' + (await metadata.text()),
      );
    return metadata.json();
  }, readFileSync(exportPath).toString('base64'));
  assert.equal(manifest.name, name);
  assert.equal(manifest.preview_only, false);
  console.log('Native persona Save As and saved bundle inspection passed.');
} finally {
  if (app) {
    const pages = app.windows();
    const page = pages[0];
    if (page)
      await page
        .evaluate(
          async ({ profileId, voiceId }) => {
            if (profileId)
              await fetch('/api/profiles/' + encodeURIComponent(profileId), { method: 'DELETE' });
            if (voiceId)
              await fetch('/api/gallery/voices/' + encodeURIComponent(voiceId), {
                method: 'DELETE',
              });
          },
          { profileId: profile, voiceId: voice },
        )
        .catch(() => undefined);
    if (page) await page.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    await waitForBackendStopped(port);
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForBackendReady(port) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/startup/progress?ts=${Date.now()}`, {
        cache: 'no-store',
      });
      last = response.ok ? await response.json() : { status: response.status };
      if (last.status === 'ready') return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Backend startup timed out: ' + JSON.stringify(last));
}

async function waitForBackendStopped(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { cache: 'no-store' });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Packaged backend on port ${port} survived application shutdown`);
}
