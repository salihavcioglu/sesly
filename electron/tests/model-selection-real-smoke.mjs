import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ui = process.env.SESLY_UI_URL || 'http://localhost:3912';
const api = process.env.SESLY_API_URL || 'http://127.0.0.1:3900';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
const page = await browser.newPage();
await page.addInitScript(() => localStorage.setItem('sesly.setup.complete.v1', '1'));

const engines = async () => {
  const response = await page.request.get(api + '/engines');
  assert.equal(response.status(), 200);
  return response.json();
};
let original;

try {
  original = (await engines()).asr;
  const target =
    original.active === 'faster-whisper-isolated' ? 'faster-whisper' : 'faster-whisper-isolated';
  assert.ok(original.backends?.some((backend) => backend.id === target && backend.available));

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(ui + '/#/settings/models/asr');
  const row = (backendId) => page.locator(`[id="engine-${backendId}"]`).locator('xpath=../..');
  const navigate = async (path) => {
    await page.evaluate((next) => {
      window.location.hash = next;
    }, path);
    await page.waitForURL((url) => url.hash === `#${path}`);
  };
  const assertSidebarRuntime = async (backendId) => {
    const backend = original.backends.find((item) => item.id === backendId);
    assert.ok(backend?.display_name, `Missing display name for ${backendId}`);
    const trigger = page.locator('footer a[aria-label$="ASR"]').first();
    await trigger.hover();
    await page.waitForFunction(
      (expected) =>
        [...document.querySelectorAll('[data-slot="tooltip-content"]')].some((tooltip) =>
          tooltip.textContent?.includes(expected),
        ),
      backend.display_name,
    );
    const tooltip = page.locator('[data-slot="tooltip-content"]:visible').first();
    assert.ok(((await tooltip.textContent()) || '').includes(backend.display_name));
    await page.mouse.move(0, 0);
  };
  const select = async (backendId) => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/engines/select') && response.request().method() === 'POST',
    );
    await row(backendId).getByRole('button', { name: 'Select', exact: true }).click();
    assert.equal((await responsePromise).status(), 200);
    await page.waitForFunction(
      async (expected) => (await (await fetch('/api/engines')).json()).asr.active === expected,
      backendId,
    );
  };

  await select(target);
  let current = (await engines()).asr;
  assert.equal(current.active, target);
  assert.equal(current.active_model, original.active_model);
  await navigate('/clone');
  await assertSidebarRuntime(target);

  await navigate('/settings/models/asr');
  await select(original.active);
  current = (await engines()).asr;
  assert.equal(current.active, original.active);
  assert.equal(current.active_model, original.active_model);
  await navigate('/clone');
  await assertSidebarRuntime(original.active);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: Models UI and Engine Ready switched ${original.active} → ${target} → ${original.active} while preserving ${original.active_model}`,
  );
} finally {
  if (original) {
    const current = (await engines()).asr;
    if (current.active !== original.active || current.active_model !== original.active_model) {
      const restored = await page.request.post(api + '/engines/select', {
        data: {
          family: 'asr',
          backend_id: original.active,
          model_id: original.active_model,
        },
      });
      assert.equal(restored.status(), 200, 'Failed to restore the original ASR selection');
    }
  }
  await browser.close();
}
