import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  getConnection: vi.fn(),
  testRemote: vi.fn(),
  useRemote: vi.fn(),
  useLocal: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@/components/bridge', () => ({
  getBridge: () => ({
    backend: {
      getConnection: mock.getConnection,
      testRemote: mock.testRemote,
      useRemote: mock.useRemote,
      useLocal: mock.useLocal,
    },
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { RemoteBackendSettings } from './remote-backend-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettings(remote = false) {
  mock.getConnection.mockResolvedValue(
    remote
      ? { remote: true, url: 'https://old-box:3900', authenticated: false }
      : { remote: false, url: 'http://127.0.0.1:3900', authenticated: false },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RemoteBackendSettings reload={mock.reload} />
    </QueryClientProvider>,
  );
}

it('tests and connects without retaining the master credential in the renderer', async () => {
  mock.testRemote.mockResolvedValue({
    ok: true,
    target: 'https://gpu-box:3900',
    detail: '0.5.2 on cuda',
    authenticated: true,
  });
  mock.useRemote.mockResolvedValue({
    ok: true,
    target: 'https://gpu-box:3900',
    detail: '',
    authenticated: true,
  });
  renderSettings();

  const url = await screen.findByRole('textbox', { name: 'settings.remote_backend_url' });
  const key = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  fireEvent.change(url, { target: { value: 'https://gpu-box:3900' } });
  fireEvent.change(key, { target: { value: 'master-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'settings.remote_backend_test' }));

  await waitFor(() =>
    expect(mock.testRemote).toHaveBeenCalledWith({
      url: 'https://gpu-box:3900',
      apiKey: 'master-secret',
    }),
  );
  expect(key).toHaveValue('');
  expect(screen.getByText('settings.remote_backend_probe_ok')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'settings.remote_backend_save' }));
  await waitFor(() =>
    expect(mock.useRemote).toHaveBeenCalledWith({ url: 'https://gpu-box:3900', apiKey: '' }),
  );
  expect(mock.reload).toHaveBeenCalledOnce();
});

it('always leaves a saved remote connection with a local recovery action', async () => {
  mock.useLocal.mockResolvedValue({
    remote: false,
    url: 'http://127.0.0.1:3900',
    authenticated: false,
  });
  renderSettings(true);

  fireEvent.click(await screen.findByRole('button', { name: 'settings.remote_backend_use_local' }));
  await waitFor(() => expect(mock.useLocal).toHaveBeenCalledOnce());
  expect(mock.reload).toHaveBeenCalledOnce();
});
