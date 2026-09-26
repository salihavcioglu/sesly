import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiJson: mock.api }));

import { selectComputeTarget, useComputeTarget } from './use-compute-target';

beforeEach(() => mock.api.mockReset());

it('asks the backend for the route of the current operation', async () => {
  mock.api.mockResolvedValue({
    target: 'local',
    op: 'dub',
    active: { remote: false, label: 'Local', reason: 'chosen' },
    remote_operations: [],
    targets: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  const result = renderHook(() => useComputeTarget(true, 'dub'), { wrapper });
  await waitFor(() => expect(result.result.current.isSuccess).toBe(true));

  expect(mock.api).toHaveBeenCalledWith('/workers/target?op=dub', {
    signal: expect.any(AbortSignal),
  });
});

it('refreshes models, engines and performance after switching compute target', async () => {
  const state = {
    target: 'worker-1',
    op: 'tts',
    active: { remote: true, worker_id: 'worker-1', label: 'Studio GPU', reason: 'selected' },
    remote_operations: ['tts'],
    targets: [],
  };
  mock.api.mockResolvedValue(state);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');

  await expect(selectComputeTarget(client, 'worker-1')).resolves.toEqual(state);

  expect(mock.api).toHaveBeenCalledWith('/workers/target', {
    method: 'POST',
    body: JSON.stringify({ target: 'worker-1' }),
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['performance-profile'] });
});
