import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  let updates = [];
  const skill = {
    id: 'dictation_refinement',
    name_key: 'settings.llmskills_dictation_refinement_name',
    description_key: 'settings.llmskills_dictation_refinement_desc',
    enabled: true,
    provider_override: 'unavailable',
    provider_display_name: 'Unavailable fixture',
    ready: false,
  };
  await page.route('**/api/api/settings/llm-skills', (route) =>
    route.fulfill({ json: { skills: [skill] } }),
  );
  await page.route('**/api/api/settings/llm-skills/dictation_refinement', (route) => {
    const body = route.request().postDataJSON();
    updates.push(body);
    Object.assign(skill, body);
    return route.fulfill({ json: { skills: [skill] } });
  });
  await page.route('**/api/api/settings/llm-providers', (route) =>
    route.fulfill({
      json: {
        active: 'local',
        providers: [
          {
            id: 'local',
            display_name: 'Local fixture',
            configured: true,
            local: true,
            base_url: 'http://localhost:11434/v1',
            model: 'fixture',
          },
          {
            id: 'unavailable',
            display_name: 'Unavailable fixture',
            configured: false,
            local: false,
          },
          { id: 'unconfigured', display_name: 'Hidden fixture', configured: false, local: false },
        ],
      },
    }),
  );
  await page.goto(
    (process.env.SESLY_UI_URL || 'http://localhost:3902') + '/#/settings/models/llm',
  );
  const toggle = page.getByRole('switch', { name: 'Dictation cleanup', exact: true });
  await toggle.waitFor();
  await page.locator('summary', { hasText: 'Unavailable fixture' }).click();
  const routing = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Unavailable fixture' }) });
  assert.equal(
    await routing
      .getByRole('button', { name: 'Unavailable fixture', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await routing.getByRole('button', { name: 'Hidden fixture', exact: true }).count(),
    0,
  );
  await routing.getByRole('button', { name: /Local fixture/ }).click();
  assert.equal(updates.at(-1).provider_override, 'local');
  await toggle.click();
  await page.waitForTimeout(100);
  assert.equal(updates.at(-1).enabled, false);
  assert(await routing.getByRole('button', { name: /Local fixture/ }).isDisabled());
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  console.log(
    'PASS: per-skill provider routing, unavailable override visibility, disabled controls and persisted toggle',
  );
} finally {
  await browser.close();
}
