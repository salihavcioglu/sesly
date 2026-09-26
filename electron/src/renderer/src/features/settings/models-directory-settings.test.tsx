import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock('@/lib/api/client', async (load) => {
  const actual = await load<typeof import('@/lib/api/client')>();
  return { ...actual, apiJson: mock.api };
});
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { authorizeModelsDirectory: mock.authorize } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { ModelsDirectorySettings } from './models-directory-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettings() {
  mock.api.mockImplementation((path: string) => {
    if (path === '/api/settings/storage/models-dir') {
      return Promise.resolve({
        configured: 'C:\\models-old',
        effective: 'C:\\models-old',
        default: 'C:\\default-models',
        restart_required: false,
      });
    }
    return Promise.resolve({});
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ModelsDirectorySettings />
    </QueryClientProvider>,
  );
}

it('sends only the native one-shot authorization when choosing a model cache folder', async () => {
  mock.authorize.mockResolvedValue({ authorization: 'choose-token', path: 'D:\\AI Models' });
  renderSettings();

  await screen.findByText('C:\\models-old');
  fireEvent.click(screen.getByRole('button', { name: 'settings.models_dir_choose' }));

  await waitFor(() =>
    expect(mock.api).toHaveBeenCalledWith('/api/settings/storage/models-dir', {
      method: 'PUT',
      body: JSON.stringify({ authorization: 'choose-token' }),
    }),
  );
  const body = JSON.parse(
    mock.api.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1].body as string,
  );
  expect(body).toEqual({ authorization: 'choose-token' });
  expect(JSON.stringify(body)).not.toContain('AI Models');
});

it('does not write after cancellation and uses an authorized empty path to reset', async () => {
  mock.authorize.mockResolvedValueOnce(null).mockResolvedValueOnce({
    authorization: 'reset-token',
    path: '',
  });
  renderSettings();

  await screen.findByText('C:\\models-old');
  fireEvent.click(screen.getByRole('button', { name: 'settings.models_dir_choose' }));
  await waitFor(() => expect(mock.authorize).toHaveBeenCalledWith(false));
  expect(mock.api.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'preferences.reset' }));
  await waitFor(() => expect(mock.authorize).toHaveBeenCalledWith(true));
  expect(mock.api).toHaveBeenCalledWith('/api/settings/storage/models-dir', {
    method: 'PUT',
    body: JSON.stringify({ authorization: 'reset-token' }),
  });
});
