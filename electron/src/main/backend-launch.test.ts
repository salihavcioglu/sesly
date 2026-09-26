// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
const state = vi.hoisted(() => ({ installed: true, packaged: false, ready: true }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
    getAppPath: () => resolve('/repo/electron'),
    getPath: () => '/user-data',
  },
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: (path: string) =>
    path === join(resolve('/repo'), 'backend', 'main.py') ||
    path === join(resolve('/repo'), 'pyproject.toml') ||
    (path.includes('.venv') ? state.installed : path.includes('uv')),
  statSync: () => ({ isFile: () => true, size: 1 }),
  accessSync: () => undefined,
}));
vi.mock('./runtime-project', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime-project')>()),
  runtimeDependenciesReady: vi.fn(async () => state.ready),
}));
vi.mock('./legacy-storage', () => ({
  legacyStorageEnv: () => ({ OMNIVOICE_DATA_DIR: '/legacy/data', OMNIVOICE_CACHE_DIR: '/legacy/models' }),
}));
import { resolveSpawnPlan, managedBackendSpawnOptions } from './backend';
afterEach(() => {
  state.installed = true;
  state.ready = true;
  state.packaged = false;
  vi.unstubAllEnvs();
});
it('launches the prepared source interpreter without syncing or downloading dependencies', async () => {
  vi.stubEnv('OMNIVOICE_BACKEND_CMD', '');
  const plan = await resolveSpawnPlan(3912);
  expect(plan).toHaveProperty('argv');
  if ('error' in plan) throw new Error(plan.error);
  expect(plan.argv[0]).toBe(
    join(
      resolve('/repo'),
      '.venv',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python',
    ),
  );
  expect(plan.argv.slice(1, 3)).toEqual(['-m', 'uvicorn']);
  expect(plan.argv.slice(-2)).toEqual(['--port', '3912']);
});
it('requires explicit source setup when no environment exists, even with uv installed', async () => {
  vi.stubEnv('OMNIVOICE_BACKEND_CMD', '');
  state.installed = false;
  expect(await resolveSpawnPlan(3900)).toEqual({
    error: expect.stringContaining('bun run setup:api'),
  });
});
it('preserves an explicitly configured command', async () => {
  vi.stubEnv('OMNIVOICE_BACKEND_CMD', '["custom-python", "-m", "uvicorn"]');
  expect(await resolveSpawnPlan(3900)).toHaveProperty('argv', ['custom-python', '-m', 'uvicorn']);
});

it('requires setup when an interpreter exists but required imports fail', async () => {
  vi.stubEnv('OMNIVOICE_BACKEND_CMD', '');
  state.ready = false;
  expect(await resolveSpawnPlan(3900)).toEqual({
    error: expect.stringContaining('bun run setup:api'),
  });
});

it('keeps native fault frames when the production log ring overflows', async () => {
  const { BackendSupervisor } = await import('./backend');
  const supervisor = new BackendSupervisor();
  const internals = supervisor as unknown as {
    pushLog(stream: 'err', line: string): void;
    log: string[];
    crashes: import('./crash-journal').CrashJournal;
  };
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const line of [
      'Fatal Python error: Segmentation fault',
      'Thread 0x111 (most recent call first):',
      ...Array(300).fill('  File "threading.py", line 10 in wait'),
      'Current thread 0x222 (most recent call first):',
      '  File "native_fault.py", line 42 in load',
      ...Array(300).fill('  File "runpy.py", line 198 in _run_module_as_main'),
      `Extension modules: ${'torch._C, '.repeat(600)}`,
    ])
      internals.pushLog('err', line);
    expect(internals.log.length).toBeLessThanOrEqual(200);
    expect(internals.log.join('\n')).not.toContain('native_fault.py');
    internals.crashes.record(null, 'SIGSEGV', 100, internals.log);
    const kept = internals.crashes.latest()!.logTail.join('\n');
    expect(kept).toContain('Fatal Python error: Segmentation fault');
    expect(kept).toContain('native_fault.py');
  } finally {
    output.mockRestore();
  }
});

it('passes legacy storage to packaged backends while preserving explicit overrides', () => {
  state.packaged = true;
  vi.stubEnv('OMNIVOICE_DATA_DIR', undefined);
  vi.stubEnv('OMNIVOICE_CACHE_DIR', undefined);
  expect(managedBackendSpawnOptions(3900).env).toMatchObject({
    OMNIVOICE_DATA_DIR: '/legacy/data', OMNIVOICE_CACHE_DIR: '/legacy/models',
  });
  vi.stubEnv('OMNIVOICE_DATA_DIR', '/chosen/data');
  vi.stubEnv('OMNIVOICE_CACHE_DIR', '/chosen/models');
  expect(managedBackendSpawnOptions(3900).env).toMatchObject({
    OMNIVOICE_DATA_DIR: '/chosen/data', OMNIVOICE_CACHE_DIR: '/chosen/models',
  });
  state.packaged = false;
  vi.stubEnv('OMNIVOICE_DATA_DIR', undefined);
  vi.stubEnv('OMNIVOICE_CACHE_DIR', undefined);
  expect(managedBackendSpawnOptions(3900).env.OMNIVOICE_DATA_DIR).toBeUndefined();
});
