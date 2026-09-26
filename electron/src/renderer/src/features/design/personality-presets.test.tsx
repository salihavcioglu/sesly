import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiJson: mock.api }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { PersonalityPresets } from './personality-presets';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('converts personality tokens to a complete attribute replacement and excludes demo cards', async () => {
  mock.api.mockResolvedValue([
    { id: 'narrator', name: 'Narrator', instruct: 'middle-aged, low pitch' },
    { id: 'demo', instruct: 'female', is_demo: true },
  ]);
  const select = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PersonalityPresets disabled={false} onSelect={select} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'clone.personality_narrator' }));
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({
      Age: 'middle-aged',
      Pitch: 'low pitch',
      Gender: 'Auto',
      EnglishAccent: 'Auto',
    }),
  );
  expect(screen.queryByRole('button', { name: 'clone.personality_demo' })).not.toBeInTheDocument();
});
it('prevents personality changes while generating', async () => {
  mock.api.mockResolvedValue([{ id: 'casual', instruct: 'young adult, moderate pitch' }]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PersonalityPresets disabled onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: 'clone.personality_casual' })).toBeDisabled();
});
