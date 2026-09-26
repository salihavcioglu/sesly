import { afterEach, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('does not advertise a native backend as ready before its first status', async () => {
  vi.stubGlobal('sesly', { backend: {} });
  const status = await import('./use-backend-status');
  expect(status.getBackendStatusSnapshot().stage).toBe('attaching');
});
it('does not replace a newer pushed status with an older initial snapshot', async () => {
  let push!: (status: unknown) => void;
  let finish!: (status: unknown) => void;
  vi.stubGlobal('sesly', {
    backend: {
      onStatus: (callback: typeof push) => {
        push = callback;
        return () => {};
      },
      getStatus: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  const status = await import('./use-backend-status');
  const stop = status.subscribeBackendStatus(() => {});
  const base = status.FALLBACK_BACKEND_STATUS;
  push({ ...base, stage: 'crashed' });
  finish({ ...base, stage: 'ready' });
  await Promise.resolve();
  expect(status.getBackendStatusSnapshot().stage).toBe('crashed');
  stop();
});

it('pauses backend queries until the native supervisor reports ready', async () => {
  onlineManager.setOnline(true);
  let push!: (status: unknown) => void;
  vi.stubGlobal('sesly', {
    backend: {
      onStatus: (callback: typeof push) => {
        push = callback;
        return () => {};
      },
      getStatus: () => new Promise(() => {}),
    },
  });

  const status = await import('./use-backend-status');
  expect(onlineManager.isOnline()).toBe(false);
  const stop = status.subscribeBackendStatus(() => {});
  push({ ...status.FALLBACK_BACKEND_STATUS, stage: 'ready' });
  expect(onlineManager.isOnline()).toBe(true);
  push({ ...status.FALLBACK_BACKEND_STATUS, stage: 'crashed' });
  expect(onlineManager.isOnline()).toBe(false);
  stop();
});
