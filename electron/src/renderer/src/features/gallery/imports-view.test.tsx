import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue({ results: [] }),
  upload: vi.fn().mockResolvedValue({}),
  persona: vi.fn().mockResolvedValue({ name: 'Bundle voice', verified_own_voice: true }),
  download: vi.fn().mockResolvedValue({}),
  save: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('./imports-api', () => ({ importsApi: mocks }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/store/clone-settings', () => ({ patchCloneSettings: mocks.patch }));
vi.mock('@/components/audio-preview-button', () => ({ AudioPreviewButton: () => null }));
import { ImportsView } from './imports-view';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ImportsView />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
it('searches only on explicit submission and imports a URL without a search request', async () => {
  show();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'narration sample' } });
  expect(mocks.search).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'common.search' }));
  await waitFor(() => expect(mocks.search).toHaveBeenCalledWith('narration sample'));
  await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'https://example.com/audio.wav' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'common.search' }));
  await waitFor(() =>
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ video_url: 'https://example.com/audio.wav', duration: 15 }),
    ),
  );
  expect(mocks.search).toHaveBeenCalledTimes(1);
});
it('imports a portable bundle and invalidates saved profiles', async () => {
  const { client, container } = show();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const file = new File(['bundle'], 'voice.ovsvoice');
  fireEvent.change(container.querySelector('input[accept=".ovsvoice,.omnivoice"]')!, {
    target: { files: [file] },
  });
  await waitFor(() => expect(mocks.persona).toHaveBeenCalledWith(file));
  await waitFor(() => expect(screen.getByText('gallery.persona_imported')).toBeInTheDocument());
  expect(invalidate).toHaveBeenCalled();
});
