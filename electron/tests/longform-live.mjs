// Explicit opt-in: performs real local synthesis using an already-installed model.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const profileId = process.env.SESLY_LIVE_PROFILE;
if (!profileId) throw new Error('Set SESLY_LIVE_PROFILE to a saved local voice profile');
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const base = process.env.SESLY_UI_URL || 'http://localhost:3902';
  const [engines, models, profiles] = await Promise.all(
    ['/engines/tts', '/models', '/profiles'].map(async (path) => {
      const response = await page.request.get(base + '/api' + path);
      assert(response.ok());
      return response.json();
    }),
  );
  assert(
    models.models.some((model) => model.repo_id === engines.active_model && model.installed),
    'Active TTS model must already be installed',
  );
  const profile = profiles.find((profile) => profile.id === profileId);
  assert(profile, 'Saved voice must exist');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let preview;
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/audiobook/preview') && response.ok())
      preview = await response.json();
  });
  await page.goto(base + '/#/audiobook');
  await page
    .locator('[data-slot=secondary-sidebar]')
    .getByRole('button', { name: profile.name, exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Script', exact: true })
    .fill(
      '# Verification\nThis is a short Sesly audiobook test.\n\n# Conclusion\nThis second chapter completes our test.',
    );
  await page.getByText('Production overrides', { exact: true }).click();
  await page.getByLabel('Seed', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Preview plan', exact: true }).click();
  await page.getByRole('button', { name: 'Preview chapter: Verification', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('audio')).some((audio) => audio.currentTime > 0),
  );
  assert(preview?.duration_s > 0);
  await page.getByRole('button', { name: 'Create audiobook', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Audiobook ready', exact: true })
    .waitFor({ timeout: 120000 });
  const output = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Audiobook ready', exact: true }) })
    .last();
  await output.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('audio')).some(
      (audio) => audio.currentSrc.includes('.m4b') && audio.currentTime > 0,
    ),
  );
  const src = await output.locator('audio').evaluate((audio) => audio.currentSrc);
  const audio = await page.request.get(src);
  assert.ok(audio.ok());
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'sesly-book-')), 'verification.m4b');
  writeFileSync(path, await audio.body());
  const { execFileSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const probeScript = [
    'import json,subprocess,sys',
    'from services.ffmpeg_utils import resolve_ffprobe',
    'd=json.loads(subprocess.check_output([resolve_ffprobe(),"-v","error","-show_chapters","-show_format","-of","json",sys.argv[1]]))',
    'assert [c["tags"]["title"] for c in d["chapters"]]==["Verification","Conclusion"],d',
    'assert float(d["chapters"][0]["end_time"])==float(d["chapters"][1]["start_time"]),d',
    'assert float(d["format"]["duration"])>0,d',
    'print("Two chapter titles, continuous timing and nonzero duration verified.")',
  ].join('\n');
  console.log(
    execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', probeScript, path], {
      env: { ...process.env, PYTHONPATH: resolve('backend') },
      encoding: 'utf8',
    }).trim(),
  );
  console.log('Artifact:', path);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: installed-model chapter preview and M4B synthesis/playback with the real backend; preview cached:',
    preview.cached,
  );
} finally {
  await browser.close();
}
