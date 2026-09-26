import { _electron as electron } from 'playwright';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const folder = mkdtempSync(join(tmpdir(), 'sesly-native-file-'));
const output = join(folder, 'transcript.txt');
const packagedExecutable = process.env.SESLY_PACKAGED_EXE?.trim();
const developmentExecutable = resolve(
  'node_modules/electron/dist',
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron',
);
let app;
try {
  app = await electron.launch({
    executablePath: packagedExecutable ? resolve(packagedExecutable) : developmentExecutable,
    args: [
      ...(packagedExecutable ? [] : [resolve('out/main/index.js')]),
      '--user-data-dir=' + join(folder, 'profile'),
    ],
    env: { ...process.env, ELECTRON_RENDERER_URL: '', SESLY_SKIP_BACKEND: '1' },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, output);
  const result = await page.evaluate(() =>
    window.sesly.files.saveData({
      data: new TextEncoder().encode('Sesly native file'),
      suggestedName: 'transcript.txt',
    }),
  );
  assert.equal(result.canceled, false);
  assert.equal(result.path, output);
  assert.equal(existsSync(output), true);
  assert.equal(readFileSync(output, 'utf8'), 'Sesly native file');
  console.log('Native renderer-generated file Save As passed.');
} finally {
  if (app) await app.close();
}
