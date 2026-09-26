// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createUninstallPlan, scanUninstallTargets, type UninstallRoots } from './uninstall-data';

const created: string[] = [];
afterEach(async () => {
  await Promise.allSettled(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<UninstallRoots & { root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'Sesly-uninstall-test-'));
  created.push(root);
  const roots = {
    root,
    data: join(root, 'OmniVoice', 'data'),
    environment: join(root, 'Sesly', 'shell'),
    logs: join(root, 'OmniVoice', 'logs'),
    userEnvironment: join(root, '.config', 'omnivoice'),
    models: join(root, '.cache', 'huggingface'),
  };
  for (const path of Object.values(roots).filter((value) => value !== root)) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'fixture.bin'), 'data');
  }
  return roots;
}

it('scans every install-owned location and keeps a shared model cache opt-in', async () => {
  const roots = await fixture();
  const targets = await scanUninstallTargets(roots);
  expect(targets.map((target) => target.key)).toEqual(['data', 'env', 'logs', 'userenv', 'models']);
  expect(targets.every((target) => target.exists && target.size_bytes === 4)).toBe(true);
  expect(targets.find((target) => target.key === 'models')?.shared).toBe(true);
  expect((await createUninstallPlan(targets, false, join(roots.root, 'home'))).paths).not.toContain(
    roots.models,
  );
  expect((await createUninstallPlan(targets, true, join(roots.root, 'home'))).paths).toContain(
    roots.models,
  );
});

it('refuses unsigned arbitrary roots and collapses descendants under an owned parent', async () => {
  const roots = await fixture();
  const arbitrary = join(roots.root, 'personal', 'documents');
  await mkdir(arbitrary, { recursive: true });
  const targets = await scanUninstallTargets({
    ...roots,
    data: arbitrary,
    logs: join(roots.environment, 'logs'),
  });
  const plan = await createUninstallPlan(targets, false, join(roots.root, 'home'));
  expect(plan.refused).toContain(arbitrary);
  expect(plan.paths).toContain(roots.environment);
  expect(plan.paths).not.toContain(join(roots.environment, 'logs'));
});

it('does not offer a nested private model directory as a separately shared target', async () => {
  const roots = await fixture();
  const targets = await scanUninstallTargets({
    ...roots,
    models: join(roots.environment, 'models'),
  });
  expect(targets.some((target) => target.key === 'models')).toBe(false);
});
