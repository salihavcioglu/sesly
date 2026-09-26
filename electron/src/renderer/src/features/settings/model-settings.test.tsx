import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api/client', () => ({
  apiJson: mock.api,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('sonner', () => ({ toast: mock.toast }));

import { DiarisationSettings } from './model-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('waits for confirmed runtime support and recovers a failed status check', async () => {
  let runtimeChecks = 0;
  mock.api.mockImplementation((path: string) => {
    if (path === '/engines/diarisation')
      return Promise.resolve({
        active: 'pyannote',
        options: [
          {
            id: 'audiocpp-sortformer',
            label: 'Sortformer',
            model: 'audio-cpp/audio.cpp-gguf',
            model_installed: true,
            runtime_installed: false,
            installed: false,
          },
        ],
      });
    if (path === '/engines/audiocpp/runtime/install/status') {
      runtimeChecks += 1;
      if (runtimeChecks === 1) return Promise.reject(new Error('Runtime status unavailable'));
      return Promise.resolve({
        installed: false,
        supported: true,
        job: { state: 'idle', progress: 0 },
      });
    }
    return Promise.resolve({});
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DiarisationSettings />
    </QueryClientProvider>,
  );

  await screen.findByText('Sortformer');
  const error = await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'modelMaintenance.install' })).toBeNull();
  expect(within(error).getByText('Runtime status unavailable')).toBeInTheDocument();

  fireEvent.click(within(error).getByRole('button', { name: 'backend.retry' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'modelMaintenance.install' })).toBeEnabled(),
  );
});

it('confirms a diarisation engine selection after the backend accepts it', async () => {
  mock.api.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/engines/diarisation/select' && init?.method === 'POST')
      return Promise.resolve({ active: 'audiocpp-sortformer' });
    if (path === '/engines/diarisation')
      return Promise.resolve({
        active: 'pyannote',
        options: [
          {
            id: 'audiocpp-sortformer',
            label: 'Sortformer',
            installed: true,
            model_installed: true,
            runtime_installed: true,
          },
        ],
      });
    if (path === '/engines/audiocpp/runtime/install/status')
      return Promise.resolve({
        installed: true,
        supported: true,
        job: { state: 'idle', progress: 1 },
      });
    return Promise.resolve({});
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DiarisationSettings />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'modelSettings.select' }));
  await waitFor(() => expect(mock.toast.success).toHaveBeenCalledWith('settings.engine_switched'));
});

it('explains remote native installation restrictions before a POST', async () => {
  mock.api.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/engines/diarisation'
        ? {
            active: 'pyannote',
            options: [
              {
                id: 'audiocpp-sortformer',
                label: 'Sortformer',
                model_installed: true,
                runtime_installed: false,
                installed: false,
              },
            ],
          }
        : {
            installed: false,
            supported: true,
            install_allowed: false,
            job: { state: 'idle', progress: 0 },
          },
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DiarisationSettings />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('engines.localInstallRequired')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'modelMaintenance.install' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(mock.api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
