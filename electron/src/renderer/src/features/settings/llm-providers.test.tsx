import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ apiJson: mock.api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { LlmProviders } from './llm-providers';

const ollama = {
  configured: true,
  id: 'ollama',
  display_name: 'Ollama (local)',
  local: true,
  needs_account: false,
  base_url: 'http://localhost:11434/v1',
  model: 'llama3.1',
  signup_url: 'https://ollama.com',
  notes: 'Local provider',
  has_key: true,
  key_from_env: false,
  base_url_from_env: false,
  model_from_env: false,
  active_from_env: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens on the local provider and activates the matching LLM engine in one action', async () => {
  mock.api.mockImplementation((path: string) => {
    if (path === '/api/settings/llm-providers')
      return Promise.resolve({ active: null, providers: [ollama] });
    if (path === '/api/settings/llm-providers/ollama')
      return Promise.resolve({ active: 'ollama', providers: [ollama] });
    if (path === '/engines/select')
      return Promise.resolve({ family: 'llm', active: 'openai-compat' });
    return Promise.resolve({});
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LlmProviders />
    </QueryClientProvider>,
  );

  expect(await screen.findByDisplayValue('http://localhost:11434/v1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'settings.llmp_save_active' }));

  await waitFor(() =>
    expect(mock.api).toHaveBeenCalledWith(
      '/engines/select',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ family: 'llm', backend_id: 'openai-compat' }),
      }),
    ),
  );
});
