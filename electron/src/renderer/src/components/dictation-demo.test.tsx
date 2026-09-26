import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ fetch: vi.fn(), json: vi.fn() }));
vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<object>()),
  apiFetch: mock.fetch,
  apiJson: mock.json,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./audio-preview-button', () => ({ AudioPreviewButton: () => null }));
import { DictationDemo } from './dictation-demo';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  mock.fetch.mockResolvedValue({
    blob: () => Promise.resolve(new Blob(['fixture'], { type: 'audio/wav' })),
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DictationDemo />
    </QueryClientProvider>,
  );
}
it('transcribes only an explicitly replayed sample and renders the real response', async () => {
  mock.json.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/dictation/readiness' ? { ready: true } : { text: 'Recognized fixture' },
    ),
  );
  mount();
  const buttons = await screen.findAllByRole('button', { name: 'demo.aria_replay' });
  expect(mock.json).toHaveBeenCalledTimes(1);
  fireEvent.click(buttons[0]!);
  fireEvent.click(buttons[1]!);
  await screen.findByText('Recognized fixture');
  expect(mock.json).toHaveBeenCalledTimes(2);
  const [path, init] = mock.json.mock.calls[1]!;
  expect(path).toBe('/transcribe');
  expect(init.body.get('audio').name).toBe('en_conversational.wav');
});
it('aborts a pending replay on departure', async () => {
  mock.json.mockImplementation((path: string) =>
    path === '/dictation/readiness' ? Promise.resolve({ ready: true }) : new Promise(() => {}),
  );
  const view = mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'demo.aria_replay' }))[0]!);
  await waitFor(() => expect(mock.json).toHaveBeenCalledTimes(2));
  const signal = mock.json.mock.calls[1]![1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
