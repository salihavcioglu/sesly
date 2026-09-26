import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { DictationOutputClient, type ShortcutEvent } from '../src/main/dictation-output';
assert.equal(process.platform, 'win32', 'Native key injection verification requires Windows');
const events: ShortcutEvent[] = [];
const client = new DictationOutputClient(
  resolve('native/desktop-bridge/target/debug/sesly-desktop-bridge.exe'),
  process.pid,
  (event) => events.push(event),
);
try {
  await client.request({ method: 'set_shortcut', accelerator: 'Ctrl+Alt+F24' });
  await assert.rejects(() =>
    client.request({ method: 'set_shortcut', accelerator: 'Ctrl+NotAKey' }),
  );
  // Only inject after registration succeeds: an occupied shortcut aborts above.
  execFileSync(
    resolve('.venv/Scripts/python.exe'),
    [
      '-c',
      `import ctypes,time
u=ctypes.windll.user32
try:
 for key in [0x11,0x12,0x87]: u.keybd_event(key,0,0,0)
 time.sleep(.1)
finally:
 for key in [0x87,0x12,0x11]: u.keybd_event(key,0,2,0)
`,
    ],
    { windowsHide: true },
  );
  for (let i = 0; i < 100 && events.length < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, 2, 'Expected one press and one release');
  assert.equal(events[0].pressed, true);
  assert.equal(events[1].pressed, false);
  assert.equal(events[0].session, events[1].session);
  await client.request({ method: 'reject', session: events[0].session });
  await client.request({ method: 'set_shortcut', accelerator: null });
  console.log(
    'PASS: real global press/release, session identity and failed replacement preserving registration; no audio or transcript delivery',
  );
} finally {
  client.close();
}
