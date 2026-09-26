import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  let submits = 0;
  let cancels = 0;
  let deletes = 0;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const job = {
    id: 'fixture',
    filename: 'one.mp4',
    status: 'running',
    langs: ['es'],
    progress: { stage: 'transcribe', percent: 35 },
    outputs: { es: 'output.mp4' },
  };
  await page.route('**/api/batch/jobs?*', (route) =>
    route.fulfill({
      json: submits
        ? [
            {
              ...job,
              status:
                new URL(route.request().url()).searchParams.get('status') === 'done'
                  ? 'done'
                  : job.status,
            },
          ]
        : [],
    }),
  );
  await page.route('**/api/batch/enqueue', (route) => {
    submits++;
    assert(route.request().postData().includes('Spanish') === false);
    return route.fulfill({ json: { job_id: 'fixture' } });
  });
  await page.route('**/api/batch/jobs/fixture/cancel', (route) => {
    cancels++;
    job.status = 'cancelled';
    return route.fulfill({ json: { cancelled: true } });
  });
  await page.route('**/api/batch/jobs/fixture', (route) => {
    assert.equal(route.request().method(), 'DELETE');
    deletes++;
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto((process.env.SESLY_UI_URL || 'http://localhost:3902') + '/#/batch');
  assert(await page.getByRole('button', { name: 'Add to Queue', exact: true }).isDisabled());
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'one.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture') });
  await page.getByRole('button', { name: 'Add to Queue', exact: true }).click();
  await page.getByRole('heading', { name: 'one.mp4' }).waitFor();
  assert.equal(submits, 1);
  assert.equal(await page.locator('progress').getAttribute('value'), '35');
  await page.reload();
  await page.getByRole('heading', { name: 'one.mp4' }).waitFor();
  assert.equal(submits, 1, 'Reload must not enqueue again');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('cancelled', { exact: true }).waitFor();
  assert.equal(cancels, 1);
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await page.getByRole('button', { name: 'Export es', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(deletes, 0);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(deletes, 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: batch enqueue, progress, reload, cancellation, export availability and confirmed deletion',
  );
} finally {
  await browser.close();
}
