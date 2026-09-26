import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('@/lib/api/client', async (load) => {
  const actual = await load<typeof import('@/lib/api/client')>();
  return { ...actual, apiJson: mock.api };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CredentialSettings } from './credential-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettings() {
  mock.api.mockImplementation((path: string) => {
    if (path === '/api/settings/hf-token/state')
      return Promise.resolve({ active: null, sources: [] });
    return Promise.resolve({ ok: true });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CredentialSettings />
    </QueryClientProvider>,
  );
  return client;
}

it('stores DeepL and Microsoft credentials only after an explicit save', async () => {
  const client = renderSettings();
  const invalidate = vi.spyOn(client, 'invalidateQueries');

  const deepL = document.querySelector<HTMLInputElement>(
    'input[aria-label="credentials.deepl_key"]',
  )!;
  const microsoft = document.querySelector<HTMLInputElement>(
    'input[aria-label="credentials.microsoft_base_url"]',
  )!;
  expect(mock.api).not.toHaveBeenCalledWith('/system/set-env', expect.anything());

  fireEvent.change(deepL, { target: { value: '  deepl-secret  ' } });
  fireEvent.click(within(deepL.closest('form')!).getByRole('button', { name: 'common.save' }));
  await waitFor(() =>
    expect(mock.api).toHaveBeenCalledWith('/system/set-env', {
      method: 'POST',
      body: JSON.stringify({ key: 'DEEPL_API_KEY', value: 'deepl-secret' }),
    }),
  );

  fireEvent.change(microsoft, {
    target: { value: '  https://translator.example  ' },
  });
  fireEvent.click(
    within(microsoft.closest('form')!).getByRole('button', {
      name: 'common.save',
    }),
  );
  await waitFor(() =>
    expect(mock.api).toHaveBeenCalledWith('/system/set-env', {
      method: 'POST',
      body: JSON.stringify({
        key: 'MICROSOFT_BASE_URL',
        value: 'https://translator.example',
      }),
    }),
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['translation-engines'],
  });
});
