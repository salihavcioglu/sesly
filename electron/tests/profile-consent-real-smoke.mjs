import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const t = JSON.parse(
  readFileSync('electron/src/renderer/src/i18n/locales/en.json', 'utf8'),
).voice_profile;
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=' +
      resolve('backend/assets/samples/dictation/en_conversational.wav'),
  ],
});
const page = await browser.newPage({ permissions: ['microphone'] });
let id;
const name = 'Consent fixture ' + Date.now();
try {
  const created = await page.request.post('http://127.0.0.1:3900/profiles', {
    multipart: {
      name,
      kind: 'design',
      instruct: 'female',
      seed: '1234',
      vd_states: '{}',
      language: 'English',
    },
  });
  assert.equal(created.status(), 200);
  id = (await created.json()).id;
  await page.goto('http://localhost:3912/#/design');
  await page.getByText('Saved voices', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit voice profile: ' + name, exact: true }).click();
  const pane = page.getByRole('complementary', { name: 'Edit voice profile', exact: true });
  await pane.locator('summary', { hasText: t.consent_title }).click();
  await pane.getByRole('button', { name: t.consent_record, exact: true }).click();
  const stop = pane.getByRole('button', { name: new RegExp(t.consent_stop) });
  await stop.waitFor();
  await page.waitForTimeout(2500);
  const submitted = page.waitForResponse(
    (res) => res.url().endsWith('/consent') && res.request().method() === 'POST',
  );
  await stop.click();
  assert.equal((await submitted).status(), 200);
  await pane.getByText(t.verified, { exact: true }).waitFor();
  const saved = await (await page.request.get('http://127.0.0.1:3900/profiles/' + id)).json();
  assert.equal(saved.verified_own_voice, 1);
  assert.equal(saved.consent_text, t.consent_statement);
  await pane.getByRole('button', { name: t.consent_revoke, exact: true }).click();
  const revoked = page.waitForResponse(
    (res) => res.url().endsWith('/consent') && res.request().method() === 'DELETE',
  );
  await pane.getByRole('button', { name: 'Confirm', exact: true }).click();
  assert.equal((await revoked).status(), 200);
  await pane.getByRole('button', { name: t.consent_record, exact: true }).waitFor();
  const cleared = await (await page.request.get('http://127.0.0.1:3900/profiles/' + id)).json();
  assert.equal(cleared.verified_own_voice, 0);
  console.log(
    'Prerecorded fixture consent capture, backend persistence, confirmation and revocation passed.',
  );
} finally {
  if (id) await page.request.delete('http://127.0.0.1:3900/profiles/' + id);
  await browser.close();
}
