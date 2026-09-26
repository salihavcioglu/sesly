import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const profile = mkdtempSync(join(tmpdir(), 'sesly-crash-restart-'));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const launch = (script) =>
  electron.launch({
    executablePath: resolve('electron/node_modules/electron/dist/electron.exe'),
    args: [resolve('electron/out/main/index.js'), '--user-data-dir=' + profile],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      SESLY_SKIP_BACKEND: '0',
      SESLY_ALLOW_MULTIPLE_INSTANCES: '1',
      OMNIVOICE_PORT: String(port),
      OMNIVOICE_BACKEND_CMD: JSON.stringify([resolve('.venv/Scripts/python.exe'), '-c', script]),
    },
  });
async function waitStatus(page, matches) {
  await page.waitForFunction(() => Boolean(window.sesly));
  // The supervisor intentionally offers a ten-second replacement-backend
  // handoff before classifying an owned exit as a crash.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => window.sesly.backend.getStatus());
    if (matches(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Backend state did not reach the expected condition');
}
async function closeThroughWindow(app, page) {
  const closed = app.waitForEvent('close');
  await page.evaluate(() => window.sesly.window.close());
  await closed;
}
let app;
try {
  app = await launch(
    "import sys,time; print('Fixture root failure', file=sys.stderr, flush=True); time.sleep(.5); sys.exit(23)",
  );
  const page = await app.firstWindow();
  const status = await waitStatus(page, (status) => status.stage === 'crashed');
  assert.equal(status.lastCrash.exitCode, 23);
  assert.ok(status.lastCrash.logTail.includes('Fixture root failure'));
  const details = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'View crash details' }) });
  await details.locator('summary').click();
  await details.getByText('Fixture root failure', { exact: true }).waitFor();
  assert.equal(await details.locator('dd').first().innerText(), '23');
  await page.waitForFunction(async () => {
    const current = await window.sesly.backend.getStatus();
    return current.lastCrash?.acknowledged === true;
  });
  await closeThroughWindow(app, page);
  app = null;
  const saved = readFileSync(join(profile, 'backend-crashes.json'), 'utf8');
  assert.equal(JSON.parse(saved)[0].acknowledged, true);
  app = await launch('import time; time.sleep(60)');
  const next = await app.firstWindow();
  const restored = await waitStatus(
    next,
    (status) => status.stage === 'starting' && Boolean(status.lastCrash),
  );
  assert.equal(restored.lastCrash.timestamp, status.lastCrash.timestamp);
  assert.equal(restored.lastCrash.exitCode, 23);
  assert.equal(restored.lastCrash.acknowledged, true);
  await closeThroughWindow(app, next);
  app = null;
  assert.equal(
    readFileSync(join(profile, 'backend-crashes.json'), 'utf8'),
    saved,
    'Intentional quit must not record another crash',
  );
  console.log(
    'Owned backend exit, acknowledged persisted diagnostics, Electron relaunch and clean-quit exclusion passed with isolated fixtures.',
  );
} finally {
  if (app) await app.close();
  rmSync(profile, { recursive: true, force: true });
}
