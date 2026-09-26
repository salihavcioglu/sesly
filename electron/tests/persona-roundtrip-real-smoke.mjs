import { chromium } from 'playwright';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ui = process.env.SESLY_UI_URL || 'http://localhost:3912';
const api = process.env.SESLY_API_URL || 'http://127.0.0.1:3900';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
const page = await browser.newPage();
await page.addInitScript(() => localStorage.setItem('sesly.setup.complete.v1', '1'));
const profiles = new Set();
let voice;
const name = 'Persona verification ' + Date.now();
const tempRoot = resolve(tmpdir());
const folder = mkdtempSync(join(tempRoot, 'sesly-persona-check-'));
try {
  const response = await page.request.post(api + '/gallery/upload', {
    multipart: {
      name,
      category: 'import',
      audio: {
        name: 'fixture.wav',
        mimeType: 'audio/wav',
        buffer: readFileSync(
          join(workspaceRoot, 'backend/assets/samples/dictation/en_conversational.wav'),
        ),
      },
    },
  });
  assert.equal(response.status(), 200);
  voice = (await response.json()).id;
  const saved = await page.request.post(
    api + '/gallery/voices/' + voice + '/save-as-profile?profile_name=' + encodeURIComponent(name),
  );
  assert.equal(saved.status(), 200);
  const originalId = (await saved.json()).profile_id;
  profiles.add(originalId);
  for (const include of [true, false]) {
    await page.goto(ui + '/#/personas');
    const profileRow = page.getByRole('button', { name, exact: true }).first();
    await profileRow.waitFor();
    const profileItem = profileRow.locator('xpath=ancestor::li[1]');
    await profileItem.hover();
    await profileItem.getByRole('button', { name: 'Edit voice profile', exact: true }).click();
    const details = page
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: 'Export persona' }) });
    if (!(await details.getAttribute('open'))) await details.locator('summary').click();
    const checkbox = details.getByRole('checkbox', { name: 'Include voice clip', exact: true });
    if ((await checkbox.isChecked()) !== include) await checkbox.click();
    const download = page.waitForEvent('download');
    await details.getByRole('button', { name: 'Export persona', exact: true }).click();
    const bundle = await download;
    const path = join(folder, include ? 'full.ovsvoice' : 'preview.ovsvoice');
    await bundle.saveAs(path);
    const metadata = await page.request.post(api + '/personas/inspect', {
      multipart: {
        file: { name: 'fixture.ovsvoice', mimeType: 'application/zip', buffer: readFileSync(path) },
      },
    });
    assert.equal(metadata.status(), 200);
    const info = await metadata.json();
    assert.equal(info.name, name);
    assert.equal(info.preview_only, !include);
    await page.evaluate(() => {
      window.location.hash = '/gallery';
    });
    await page.getByRole('button', { name: 'My Imports', exact: true }).click();
    const imported = page.waitForResponse(
      (res) => res.url().endsWith('/personas/import') && res.request().method() === 'POST',
    );
    await page.locator('input[accept=".ovsvoice,.omnivoice"]').setInputFiles(path);
    const result = await imported;
    assert.equal(result.status(), 200);
    profiles.add((await result.json()).profile_id);
  }
  console.log(
    'Real persona exports with/without reference, backend inspection and UI re-import passed.',
  );
} finally {
  for (const id of profiles) await page.request.delete(api + '/profiles/' + encodeURIComponent(id));
  if (voice) await page.request.delete(api + '/gallery/voices/' + encodeURIComponent(voice));
  await browser.close();
  const resolvedFolder = resolve(folder);
  if (
    dirname(resolvedFolder) !== tempRoot ||
    !basename(resolvedFolder).startsWith('sesly-persona-check-')
  ) {
    throw new Error(`Refusing to remove unexpected smoke directory: ${resolvedFolder}`);
  }
  rmSync(resolvedFolder, { recursive: true, force: true });
}
