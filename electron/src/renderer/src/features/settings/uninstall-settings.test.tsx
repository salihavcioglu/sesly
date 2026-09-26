import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  scan: vi.fn(),
  purge: vi.fn(() => new Promise(() => undefined)),
  toastError: vi.fn(),
}));

vi.mock('@/components/bridge', () => ({
  getBridge: () => ({
    maintenance: { scanUninstall: mock.scan, purgeUninstall: mock.purge },
  }),
}));
vi.mock('sonner', () => ({ toast: { error: mock.toastError } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'settings.uninstall_confirm_word' ? 'DELETE' : key),
  }),
}));

import { UninstallSettings, uninstallBytes } from './uninstall-settings';

const targets = [
  { key: 'data' as const, path: 'C:\\OmniVoice', size_bytes: 1024, exists: true, shared: false },
  { key: 'env' as const, path: 'C:\\Sesly', size_bytes: 2048, exists: true, shared: false },
  {
    key: 'models' as const,
    path: 'C:\\Users\\pal\\.cache\\huggingface',
    size_bytes: 8192,
    exists: true,
    shared: true,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps shared models out of the default purge and gates it on typed confirmation', async () => {
  mock.scan.mockResolvedValue(targets);
  render(<UninstallSettings />);
  await screen.findByText('C:\\OmniVoice');
  expect(uninstallBytes(targets, false)).toBe(3072);
  expect(uninstallBytes(targets, true)).toBe(11_264);

  fireEvent.click(screen.getByRole('button', { name: 'settings.uninstall' }));
  const confirm = await screen.findByRole('button', { name: 'settings.uninstall_confirm' });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);

  await waitFor(() => expect(mock.purge).toHaveBeenCalledWith(false));
});

it('passes the explicit shared-cache opt-in to native cleanup', async () => {
  mock.scan.mockResolvedValue(targets);
  render(<UninstallSettings />);
  await screen.findByText('C:\\OmniVoice');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'settings.uninstall' }));
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(screen.getByRole('button', { name: 'settings.uninstall_confirm' }));
  await waitFor(() => expect(mock.purge).toHaveBeenCalledWith(true));
});
