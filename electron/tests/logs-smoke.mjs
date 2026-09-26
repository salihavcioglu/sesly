import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  });
  try {
    const p = await b.newPage();
    let clears = 0;
    await p.route('**/api/system/logs?tail=1000', (r) =>
      r.fulfill({
        json: {
          lines: clears ? [] : ['INFO ready\n', 'ERROR fixture problem\n'],
          exists: true,
          path: 'fixture.log',
        },
      }),
    );
    await p.route('**/api/system/logs/clear', (r) => {
      clears++;
      return r.fulfill({ json: { cleared: true } });
    });
    await p.goto((process.env.SESLY_UI_URL || 'http://localhost:3902') + '/#/settings/logs');
    const log = p.getByRole('log');
    await log.getByText('INFO ready', { exact: false }).waitFor();
    await p
      .getByRole('region', { name: 'Logs', exact: true })
      .getByRole('searchbox', { name: 'Search…', exact: true })
      .fill('ERROR');
    if ((await log.innerText()).includes('INFO')) throw Error('Filter failed');
    await p.getByRole('button', { name: 'Clear', exact: true }).click();
    if (clears) throw Error('Cleared before confirmation');
    await p.getByRole('button', { name: 'Clear', exact: true }).last().click();
    if (clears !== 1) throw Error('Clear not requested');
    await p.getByRole('button', { name: 'Frontend', exact: true }).click();
    await p.evaluate(() => console.warn('frontend-log-fixture'));
    await p.getByRole('button', { name: 'Refresh', exact: true }).click();
    await p
      .getByRole('region', { name: 'Logs', exact: true })
      .getByRole('searchbox', { name: 'Search…', exact: true })
      .fill('frontend-log-fixture');
    await log.getByText('frontend-log-fixture', { exact: false }).waitFor();
    console.log('Logs backend/filter/confirmed clear/frontend capture verified');
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
