import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiJson: mock.api }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { AnalyticsConsent } from './analytics-consent';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <AnalyticsConsent />
    </QueryClientProvider>,
  );
  return client;
}
it.each([true, false])(
  'persists only an explicit %s choice and marks it prompted',
  async (enabled) => {
    mock.api.mockResolvedValue({ available: true, prompted: false, opted_in: false });
    const client = mount();
    const yes = await screen.findByRole('button', { name: 'consent.yes' });
    const no = screen.getByRole('button', { name: 'consent.no' });
    expect(yes.className).toBe(no.className);
    expect(mock.api).toHaveBeenCalledTimes(1);
    fireEvent.click(enabled ? yes : no);
    await waitFor(() =>
      expect(client.getQueryData(['privacy', 'analytics'])).toMatchObject({
        prompted: true,
        opted_in: enabled,
      }),
    );
    expect(mock.api).toHaveBeenLastCalledWith('/api/settings/analytics', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    expect(screen.queryByRole('button', { name: 'consent.yes' })).not.toBeInTheDocument();
  },
);
it('leaves consent unprompted and retryable after a failed write', async () => {
  mock.api
    .mockResolvedValueOnce({ available: true, prompted: false, opted_in: false })
    .mockRejectedValue(new Error('offline'));
  const client = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'consent.no' }));
  await screen.findByRole('alert');
  expect(client.getQueryData(['privacy', 'analytics'])).toMatchObject({
    prompted: false,
    opted_in: false,
  });
  expect(screen.getByRole('button', { name: 'consent.yes' })).toBeEnabled();
});
it('does not ask again after an earlier choice', async () => {
  mock.api.mockResolvedValue({ available: true, prompted: true, opted_in: false });
  mount();
  await waitFor(() => expect(mock.api).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'consent.yes' })).not.toBeInTheDocument();
});
