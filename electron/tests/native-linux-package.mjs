import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageLinuxLibraries, packageLinuxLibraryNotices } from '../native-linux-libraries.mjs';

const directory = await mkdtemp(join(tmpdir(), 'vs-native-package-'));
try {
  const source = resolve('native/desktop-bridge/target/release/sesly-desktop-bridge');
  const binary = join(directory, 'sesly-desktop-bridge');
  await copyFile(source, binary);
  await packageLinuxLibraries(source, binary);
  await packageLinuxLibraryNotices(source, binary);
  const licenses = await readdir(join(directory, 'licenses'));
  assert(licenses.some((name) => name.startsWith('libxdo') && name.endsWith('.copyright')));
  const result = execFileSync(binary, [String(process.pid)], {
    input: '{"id":1,"method":"ping"}\n',
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.deepEqual(JSON.parse(result), { id: 1, result: { protocol: 1 } });
  console.log('PASS: Linux native helper dependencies, copyright notices, and protocol');
} finally {
  await rm(directory, { recursive: true, force: true });
}
