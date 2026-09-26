import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.SESLY_UI_URL || 'http://localhost:3912';
const app = await electron.launch({
  executablePath: resolve('electron/node_modules/electron/dist/electron.exe'),
  args: [
    resolve('electron/out/main/index.js'),
    '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'sesly-dev-dictation-')),
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-audio-capture=' +
      resolve('backend/assets/samples/dictation/en_conversational.wav'),
  ],
  env: { ...process.env, ELECTRON_RENDERER_URL: base },
  timeout: 30000,
});
try {
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((page) => page.url().startsWith(base));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(
    page,
    'Main dev renderer not found: ' +
      app
        .windows()
        .map((page) => page.url())
        .join(', '),
  );
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page
    .waitForFunction(() => window.sesly?.backend, undefined, { timeout: 10000 })
    .catch((error) => {
      console.error('Renderer:', page.url(), errors);
      throw error;
    });
  await page.evaluate(() => {
    window.location.hash = '/transcriptions';
  });
  await page.getByRole('button', { name: 'Dictation', exact: true }).click();
  await page.getByText('Listening\u2026', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(8000);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const transcript = page.locator('aside button p.line-clamp-2').first();
  await transcript.waitFor({ timeout: 60000 });
  const text = await transcript.innerText();
  assert(text.length > 10);
  console.log(
    'PASS: native Electron dev bridge, same-origin PCM WebSocket and real installed ASR using prerecorded input:',
    text.slice(0, 160),
  );
} finally {
  await app.close();
}
