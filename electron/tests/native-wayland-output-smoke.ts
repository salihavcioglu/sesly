// Run on a real Wayland session after building native/desktop-bridge.
// Tray capture must remain clipboard-only: this test never emits input events.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DictationOutputClient } from '../src/main/dictation-output';

assert.equal(process.platform, 'linux', 'Wayland output verification requires Linux');
assert(process.env.WAYLAND_DISPLAY, 'Wayland output verification requires WAYLAND_DISPLAY');

const helper = new DictationOutputClient(
  process.env.SESLY_NATIVE_OUTPUT_EXE ||
    resolve('native/desktop-bridge/target/debug/sesly-desktop-bridge'),
);
try {
  const session = Number(await helper.request({ method: 'begin', origin: 'tray' }));
  assert(Number.isSafeInteger(session) && session > 0);
  await helper.request({ method: 'activate', session });
  assert.equal(
    await helper.request({ method: 'deliver', session, text: 'Sesly Wayland smoke' }),
    'copied',
  );
  await assert.rejects(
    helper.request({ method: 'type_delta', session, text: 'never typed', backspaces: 0 }),
    /clipboard-only/,
  );
  await helper.request({ method: 'finish', session });
  console.log('PASS: Wayland tray output uses clipboard fallback and blocks live input');
} finally {
  helper.close();
}
