import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'win32');
const profile = mkdtempSync(join(tmpdir(), 'sesly-global-check-'));
const app = await electron.launch({
  executablePath: resolve('electron/node_modules/electron/dist/electron.exe'),
  args: [
    resolve('electron/out/main/index.js'),
    '--user-data-dir=' + profile,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
  env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  timeout: 30000,
});
const press = () =>
  execFileSync(
    resolve('.venv/Scripts/python.exe'),
    [
      '-c',
      `import ctypes,time
u=ctypes.windll.user32
try:
 for key in [0x11,0x12,0x87]: u.keybd_event(key,0,0,0)
 time.sleep(.08)
finally:
 for key in [0x87,0x12,0x11]: u.keybd_event(key,0,2,0)
`,
    ],
    { windowsHide: true },
  );
try {
  const main = await app.firstWindow();
  await main.waitForFunction(() => window.sesly?.capture);
  await main.evaluate(() => localStorage.setItem('sesly.setup.complete.v1', 'true'));
  await main.reload();
  await main.waitForFunction(() => window.sesly?.capture);
  let sessions = 0;
  await app.context().routeWebSocket(/\/ws\/transcribe/, (peer) => {
    sessions++;
    peer.onMessage((message) => {
      if (message === 'EOF')
        peer.send(JSON.stringify({ type: 'final', final_kind: 'summary', text: '' }));
    });
  });
  await main.evaluate(() => {
    window.location.hash = '/settings/models/dictation';
  });
  const settings = main
    .locator('section')
    .filter({ has: main.getByRole('heading', { name: 'Dictation shortcut', exact: true }) });
  await settings.getByRole('button', { name: 'Record shortcut', exact: true }).click();
  await main.keyboard.press('q');
  await settings.getByText(/Add a modifier/).waitFor();
  await main.keyboard.press('Escape');
  await settings.getByRole('button', { name: 'Record shortcut', exact: true }).click();
  await main.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F24',
        code: 'F24',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await main.waitForFunction(
    async () => (await window.sesly.capture.getShortcut()).accelerator === 'Ctrl+Alt+F24',
  );
  await main.evaluate(async () => {
    await window.sesly.capture.syncPreferences({ enabled: true, mode: 'hold' });
  });
  assert((await main.evaluate(() => window.sesly.capture.getShortcut())).active);
  assert.equal(
    JSON.parse(readFileSync(join(profile, 'dictation-shortcut.json'), 'utf8')).accelerator,
    'Ctrl+Alt+F24',
  );
  const opened = app.waitForEvent('window');
  await settings.getByText('Press your shortcut anywhere to test', { exact: true }).waitFor();
  press();
  const widget = await opened;
  await settings.getByText('Verified — hotkey works on this machine', { exact: true }).waitFor();
  await widget.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 30000 });
  await widget.getByRole('button', { name: 'Stop', exact: true }).click();
  await widget
    .getByText('No speech detected', { exact: true })
    .waitFor({ timeout: 30000 })
    .catch(async (error) => {
      console.error('Recorder:', await widget.locator('body').innerText());
      console.error('Intercepted dictation sessions:', sessions);
      throw error;
    });
  // Restart directly from the visible no-speech result, without dismissing it.
  await widget.waitForTimeout(160); // beyond the native duplicate-press interval
  press();
  for (let i = 0; i < 100 && sessions < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sessions, 2, 'Visible completion must accept another shortcut without dismissal');
  await widget.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await widget.getByRole('button', { name: 'Stop', exact: true }).click();
  await widget.getByText('No speech detected', { exact: true }).waitFor();
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click();
  await main.evaluate(() =>
    window.sesly.capture.syncPreferences({ enabled: true, mode: 'toggle' }),
  );
  press();
  await widget.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  // Release does not end toggle capture; a second press must stop it.
  press();
  await widget.getByText('No speech detected', { exact: true }).waitFor();
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click();
  await main.evaluate(() =>
    window.sesly.capture.syncPreferences({ enabled: false, mode: 'toggle' }),
  );
  assert.equal((await main.evaluate(() => window.sesly.capture.getShortcut())).active, false);
  console.log(
    'PASS: native shortcut opens recorder, hold capture completes, toggle waits for second press, disable unregisters',
  );
} finally {
  await app.close();
}
