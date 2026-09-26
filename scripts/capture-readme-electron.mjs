/** Capture the real Electron renderer in an isolated, read-only browser context.
 * Run against `cd electron && bun run dev`; no user workspace state is changed.
 * CHROMIUM_PATH can select an installed Chromium binary.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.SESLY_CAPTURE_URL || 'http://localhost:3902';
const output = resolve('docs/media/electron');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: '/tmp/sesly-readme-video', size: { width: 1440, height: 960 } } });
await context.addInitScript(() => {
  localStorage.setItem('sesly.setup.complete.v1', '1');
  localStorage.setItem('sesly.theme.v2', JSON.stringify({mode:'dark',light:'signal',dark:'signal'}));
  localStorage.setItem('sesly.clone.settings.v1', JSON.stringify({selectedProfileId:'demo0001',text:'Every voice has a story. Bring yours to life with Sesly — created on your machine, in your own way.'}));
  localStorage.setItem('omnivoice.demoClonePrompted', '1');
  localStorage.setItem('sesly.appearance', JSON.stringify({font:'inter',scale:100,glass:true}));
});
// Capture only bundled demo voices; never publish personal voices or project history.
await context.route('**/api/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() !== 'GET') return route.abort();
  if (path === '/api/profiles') {
    const response = await route.fetch();
    return route.fulfill({ response, json: (await response.json()).filter(profile => profile.id === 'demo0001') });
  }
  if (['/api/history','/api/projects','/api/transcriptions'].includes(path)) return route.fulfill({json:[]});
  return route.continue();
});
const page = await context.newPage();
try {
  await page.goto(`${base}/#/clone`);
  await page.getByRole('heading', {name:'Voice cloning', exact:true}).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({path:resolve(output,'voice-cloning.png')});
  for (const [route, file] of [['/design','voice-design'],['/dub','dubbing'],['/settings/models','models']]) {
    await page.evaluate(route => {location.hash=route;},route);
    await page.waitForTimeout(1800);
    if (route === '/design') {
      const fields = page.locator('textarea');
      await page.getByRole('button', {name:'Narrator',exact:true}).click();
      if (await fields.count() > 1) await fields.last().fill('Beyond the city lights, a quieter world begins. Every trail holds a story, and every journey starts with a little curiosity.');
      await page.waitForTimeout(1600);
    }
    if (route === '/dub') {
      await page.getByRole('button', {name:'Play',exact:true}).first().click();
      await page.waitForTimeout(2200);
    }
    await page.screenshot({path:resolve(output,`${file}.png`)});
    console.log(file, (await page.locator('h1,h2').allTextContents()).slice(0,5));
  }
  await page.evaluate(()=>{location.hash='/clone';});
  await page.waitForTimeout(1800);
  console.log('Video:',await page.video().path());
} finally { await context.close(); await browser.close(); }
