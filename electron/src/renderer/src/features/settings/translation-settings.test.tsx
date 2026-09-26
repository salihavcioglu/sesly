import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/api/client', () => ({ apiJson: mock.api, describeError: String }));
vi.mock('sonner', () => ({ toast: mock.toast }));
vi.mock('@/hooks/use-backend-status', () => ({
  useBackendStatus: () => ({ stage: 'ready' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { TranslationSettings } from './translation-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('refreshes performance selections immediately after changing translation engine', async () => {
  mock.api.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/engines/translation/select' && init?.method === 'POST')
      return Promise.resolve({ active: 'nllb' });
    if (path === '/engines/translation') {
      return Promise.resolve({
        active: 'argos',
        sandboxed: false,
        engines: [
          {
            id: 'argos',
            display_name: 'Argos',
            category: 'offline',
            installed: true,
            ready: true,
            needs_key: false,
            pip_package: null,
          },
          {
            id: 'nllb',
            display_name: 'NLLB',
            category: 'offline',
            installed: true,
            ready: true,
            needs_key: false,
            pip_package: null,
          },
        ],
      });
    }
    return Promise.resolve({});
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');

  render(
    <QueryClientProvider client={client}>
      <TranslationSettings />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'modelSettings.select' }));

  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['performance-profile'] }),
  );
  expect(mock.toast.success).toHaveBeenCalledWith('settings.engine_switched');
});

it('shows unavailable translation engines without an extra expansion step', async () => {
  mock.api.mockResolvedValue({
    active: 'argos',
    sandboxed: false,
    engines: [
      {
        id: 'deepl',
        display_name: 'DeepL',
        category: 'online',
        installed: false,
        ready: false,
        needs_key: true,
        pip_package: null,
      },
    ],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TranslationSettings />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'DeepL' })).toBeVisible();
  expect(screen.getByText('modelSettings.unavailable')).toBeVisible();
});
