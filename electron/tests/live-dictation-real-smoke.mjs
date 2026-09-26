import { chromium } from 'playwright';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-audio-capture=' +
      resolve('backend/assets/samples/dictation/en_conversational.wav'),
  ],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = process.env.SESLY_UI_URL || 'http://localhost:3912';
  await page.goto(base + '/#/transcriptions');
  await page.getByRole('button', { name: 'Dictation', exact: true }).click();
  await page.getByText('Listening\u2026', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(8000);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const transcript = page.locator('aside button p.line-clamp-2').first();
  await transcript.waitFor({ timeout: 60000 });
  const text = await transcript.innerText();
  assert(text.length > 10);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real live PCM dictation from prerecorded fake microphone:',
    text.slice(0, 180),
  );
} catch (error) {
  console.error(await browser.contexts()[0]?.pages()[0]?.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
