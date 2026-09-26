import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'win32', 'This foreground-ownership smoke requires Windows');
const executablePath = resolve('electron/node_modules/electron/dist/electron.exe');
const profile = mkdtempSync(join(tmpdir(), 'sesly-insertion-check-'));
const app = await electron.launch({
  executablePath,
  args: [
    resolve('electron/out/main/index.js'),
    '--user-data-dir=' + join(profile, 'app'),
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
  env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  timeout: 30000,
});
let target;
try {
  const main = await app.firstWindow();
  await main.waitForFunction(() => window.sesly?.capture);
  await app.evaluate(({ Tray }) => {
    const original = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (menu) {
      globalThis.captureTestMenu = menu;
      globalThis.captureTestTray = this;
      return original.call(this, menu);
    };
  });
  await main.evaluate(() =>
    window.sesly.capture.labels({
      show: 'Show Sesly',
      start: 'Start dictation',
      stop: 'Stop',
      settings: 'Settings',
      exit: 'Exit',
    }),
  );
  target = await electron.launch({
    executablePath,
    args: [
      resolve('electron/tests/capture-target.cjs'),
      '--user-data-dir=' + join(profile, 'target'),
    ],
    timeout: 30000,
  });
  const input = await target.firstWindow();
  await input.getByRole('textbox').fill('');
  await target.evaluate(async ({ clipboard, ClipboardItem }) => {
    const current = await clipboard.read();
    globalThis.originalClipboard = await Promise.all(
      current.map(
        async (item) =>
          new ClipboardItem(
            Object.fromEntries(
              await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])),
            ),
          ),
      ),
    );
    await clipboard.writeText('Sesly isolated clipboard verification');
  });
  await target.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  await input.getByRole('textbox').focus();
  const expectedHandle = await target.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString(),
  );
  const foreground = execFileSync(
    resolve('.venv/Scripts/python.exe'),
    [
      '-c',
      `import ctypes,sys,time
u=ctypes.windll.user32; k=ctypes.windll.kernel32
u.GetForegroundWindow.restype=ctypes.c_void_p
u.SetForegroundWindow.argtypes=[ctypes.c_void_p]
u.BringWindowToTop.argtypes=[ctypes.c_void_p]
u.GetWindowThreadProcessId.argtypes=[ctypes.c_void_p,ctypes.c_void_p]
target=int(sys.argv[1]); current=k.GetCurrentThreadId(); foreground=u.GetWindowThreadProcessId(u.GetForegroundWindow(),None)
attached=u.AttachThreadInput(current,foreground,True)
try: u.BringWindowToTop(target); u.SetForegroundWindow(target); time.sleep(.1)
finally:
 if attached: u.AttachThreadInput(current,foreground,False)
print(u.GetForegroundWindow())`,
      expectedHandle,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  assert.equal(
    foreground,
    expectedHandle,
    'Disposable input must be the actual Windows foreground window before capture',
  );
  await app.evaluate(async () => {
    globalThis.captureTestTray.emit('mouse-enter', {}, { x: 0, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  // Real native target capture, clipboard delivery and restoration; only ASR is deterministic.
  await app.context().routeWebSocket(/\/ws\/transcribe/, (peer) =>
    peer.onMessage((message) => {
      if (message === 'EOF') {
        peer.send(
          JSON.stringify({
            type: 'final',
            final_kind: 'utterance',
            text: 'Native delivery works.',
          }),
        );
        peer.send(JSON.stringify({ type: 'final', final_kind: 'utterance', text: 'Twice.' }));
        peer.send(
          JSON.stringify({
            type: 'final',
            final_kind: 'summary',
            text: 'Native delivery works. Twice.',
          }),
        );
      }
    }),
  );
  const next = app.waitForEvent('window');
  await app.evaluate(() =>
    globalThis.captureTestMenu.items
      .find((item) => item.label.startsWith('Start dictation'))
      .click(),
  );
  const widget = await next;
  await widget.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 30000 });
  await widget.getByRole('button', { name: 'Stop', exact: true }).click();
  await input
    .waitForFunction(
      () => document.querySelector('textarea').value === 'Native delivery works. Twice.',
      undefined,
      { timeout: 5000 },
    )
    .catch(async (error) => {
      console.error('Disposable target:', await input.getByRole('textbox').inputValue());
      console.error('Recorder:', await widget.locator('body').innerText());
      throw error;
    });
  const restored = await target.evaluate(async ({ clipboard }) => {
    for (let i = 0; i < 100; i++) {
      if ((await clipboard.readText()) === 'Sesly isolated clipboard verification')
        return true;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return false;
  });
  assert(restored, 'Native delivery did not restore the clipboard');
  console.log(
    'PASS: real native insertion into a separate disposable app, ordered utterances and clipboard restoration',
  );
} finally {
  await app.close();
  if (target) {
    await target.evaluate(async ({ clipboard }) => {
      if (globalThis.originalClipboard) {
        if (globalThis.originalClipboard.length)
          await clipboard.write(globalThis.originalClipboard);
        else clipboard.clear();
      }
    });
    await target.close();
  }
}
