// Run after cargo build --manifest-path native/desktop-bridge/Cargo.toml.
// These requests do not capture focus, type, or write to the clipboard.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DictationOutputClient } from '../src/main/dictation-output';

const helper = new DictationOutputClient(
  process.env.SESLY_NATIVE_OUTPUT_EXE ||
    resolve(
      'native/desktop-bridge/target/debug/sesly-desktop-bridge' +
        (process.platform === 'win32' ? '.exe' : ''),
    ),
);
try {
  assert.deepEqual(await helper.request({ method: 'ping' }), { protocol: 1 });
  await assert.rejects(helper.request({ method: 'deliver', session: 1234, text: 'stale' }));
  await assert.rejects(helper.request({ method: 'copy', session: 1234, text: 'stale' }));
  console.log('PASS: native output transport and stale-session rejection');
} finally {
  helper.close();
}
