import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  choose: vi.fn(),
  relocate: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@/lib/api/client', async (load) => {
  const actual = await load<typeof import('@/lib/api/client')>();
  return { ...actual, apiJson: mock.api };
});
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({
    maintenance: {
      chooseDataDirectory: mock.choose,
      relocateDataDirectory: mock.relocate,
      onRelocationProgress: mock.subscribe,
    },
  }),
}));
vi.mock('sonner', () => ({
  toast: { error: mock.toastError, success: mock.toastSuccess, warning: mock.toastWarning },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { DataDirectorySettings } from './data-directory-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettings() {
  mock.api.mockResolvedValue({ data_dir: 'C:\\Sesly-old' });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DataDirectorySettings />
    </QueryClientProvider>,
  );
}

it('shows the verified move plan and sends only its one-shot authorization', async () => {
  mock.choose.mockResolvedValue({
    authorization: 'move-token',
    source: 'C:\\Sesly-old',
    target: 'D:\\Sesly',
    size_bytes: 2048,
    file_count: 7,
  });
  mock.relocate.mockResolvedValue({
    path: 'D:\\Sesly',
    size_bytes: 2048,
    file_count: 7,
    removed_source: true,
  });
  renderSettings();

  await screen.findByText('C:\\Sesly-old');
  fireEvent.click(screen.getByRole('button', { name: 'settings.data_move_choose' }));
  await screen.findByText('D:\\Sesly');
  fireEvent.click(screen.getByRole('button', { name: 'settings.data_move_confirm' }));

  await waitFor(() => expect(mock.relocate).toHaveBeenCalledWith('move-token'));
  expect(mock.relocate).not.toHaveBeenCalledWith(expect.stringContaining('Sesly'));
  await waitFor(() => expect(mock.toastSuccess).toHaveBeenCalled());
});

it('turns unsafe destination errors into a clear localized message', async () => {
  mock.choose.mockRejectedValue(new Error('target_not_empty'));
  renderSettings();
  fireEvent.click(await screen.findByRole('button', { name: 'settings.data_move_choose' }));
  await waitFor(() =>
    expect(mock.toastError).toHaveBeenCalledWith('settings.data_move_error_target_not_empty'),
  );
  expect(mock.relocate).not.toHaveBeenCalled();
});
