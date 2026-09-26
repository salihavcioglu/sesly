import { _electron as electron } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const executablePath =
  process.env.SESLY_PACKAGED_EXE ||
  resolve(
    process.platform === 'win32'
      ? 'electron/release/win-unpacked/Sesly.exe'
      : process.platform === 'darwin'
        ? 'electron/release/mac/Sesly.app/Contents/MacOS/Sesly'
        : 'electron/release/linux-unpacked/sesly-electron',
  );
const profile = mkdtempSync(join(tmpdir(), 'sesly-packaged-repair-'));
const app = await electron.launch({
  executablePath,
  args: ['--user-data-dir=' + profile],
  env: {
    ...process.env,
    SESLY_ALLOW_MULTIPLE_INSTANCES: '1',
    SESLY_SKIP_BACKEND: '1',
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.sesly?.repair));
  const state = await page.evaluate(() => window.sesly.repair.getState());
  assert.equal(state.workspaceAvailable, false);
  assert.equal(state.workspacePath, undefined);

  const agents = await page.evaluate(() => window.sesly.repair.list());
  assert.ok(
    agents.some((agent) => agent.available),
    'At least one local agent is required',
  );
  await page.evaluate(() => {
    window.location.hash = '/settings/updates';
  });
  const launcher = page.getByRole('button', { name: 'Repair with an agent' });
  await launcher.waitFor();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('sesly:repair-agent-open', {
        detail: { report: 'ACTION_REQUEST: inspect the current app setup', autoFix: false },
      }),
    );
  });
  const dock = page.getByRole('region', { name: 'Repair with an agent' });
  await dock.waitFor();
  assert.equal(await dock.getByRole('button', { name: 'Fix', exact: true }).isEnabled(), true);
  assert.equal(await dock.getByRole('button', { name: 'Diagnose', exact: true }).isEnabled(), true);
  assert.equal(await dock.getByRole('button', { name: 'Choose folder…' }).count(), 0);

  const ordinaryError = await page.evaluate(async () => {
    const available = (await window.sesly.repair.list()).find((agent) => agent.available);
    try {
      await window.sesly.repair.start({
        agent: available.id,
        mode: 'diagnose',
        report: 'Diagnose this renderer failure',
        context: '{}',
      });
      return '';
    } catch (error) {
      return String(error);
    }
  });
  assert.match(ordinaryError, /source checkout is required/i);

  const unavailable = agents.find((agent) => !agent.available);
  if (unavailable) {
    const actionError = await page.evaluate(async (agent) => {
      try {
        await window.sesly.repair.start({
          agent,
          mode: 'fix',
          report: 'ACTION_REQUEST: inspect the current app setup',
          context: '{}',
        });
        return '';
      } catch (error) {
        return String(error);
      }
    }, unavailable.id);
    assert.match(actionError, /agent is not installed/i);
    assert.doesNotMatch(actionError, /source checkout is required/i);
  }
  console.log(
    'PASS: packaged app actions run without source while code repair remains source-gated',
  );
} finally {
  await app.close();
  rmSync(profile, { recursive: true, force: true });
}
