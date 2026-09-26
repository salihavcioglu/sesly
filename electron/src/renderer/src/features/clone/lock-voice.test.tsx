import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiJson: mock.api }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { LockVoice } from './lock-voice';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount(seed: number | null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LockVoice profileId="voice/id" historyId="take" seed={seed} />
    </QueryClientProvider>,
  );
}
it('locks the exact take, preserves seed zero, and prevents repeat submissions', async () => {
  let finish!: () => void;
  mock.api.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mount(0);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.api).toHaveBeenCalledTimes(1);
  const [path, opts] = mock.api.mock.calls[0];
  expect(path).toBe('/profiles/voice%2Fid/lock');
  expect(opts.body.get('history_id')).toBe('take');
  expect(opts.body.get('seed')).toBe('0');
  finish();
  expect(await screen.findByRole('status')).toHaveTextContent('profiles.locked');
  expect(screen.getByRole('button')).toBeDisabled();
});
it('omits an unknown seed and permits retry after failure', async () => {
  mock.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
  mount(null);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert');
  expect(mock.api.mock.calls[0][1].body.has('seed')).toBe(false);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
});
