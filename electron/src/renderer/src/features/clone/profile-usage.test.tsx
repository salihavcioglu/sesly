import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  open: vi.fn(),
  navigate: vi.fn(),
  session: { phase: 'idle', recovery: null },
}));
vi.mock('@/lib/api/client', () => ({
  apiJson: mocks.api,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../dub/dub-session', () => ({
  useDubSession: () => mocks.session,
  openDubProject: mocks.open,
}));
vi.mock('../longform/longform-session', () => ({ useLongformSession: () => ({ active: null }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { ProfileUsagePanel } from './profile-usage';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  mocks.session.phase = 'idle';
});
const usage = {
  synth_total: 3,
  project_total_segments: 2,
  projects: [{ project_id: 'p/1', project_name: 'My project', segment_count: 2 }],
};
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProfileUsagePanel id="voice/1" />
    </QueryClientProvider>,
  );
}
it('loads scoped usage and only replaces the workspace after confirmation', async () => {
  mocks.api.mockResolvedValueOnce(usage).mockResolvedValueOnce({ id: 'p/1' });
  mocks.open.mockReturnValue(true);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /My project/ }));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.api).toHaveBeenCalledWith('/profiles/voice%2F1/usage', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dub' }));
  expect(mocks.api).toHaveBeenLastCalledWith('/projects/p%2F1');
});
it('blocks project replacement during production', async () => {
  mocks.session.phase = 'transcribing';
  mocks.api.mockResolvedValue(usage);
  mount();
  expect(await screen.findByRole('button', { name: /My project/ })).toBeDisabled();
  expect(mocks.open).not.toHaveBeenCalled();
});
it('keeps the pane and shows the retryable reason when opening is rejected', async () => {
  mocks.api.mockResolvedValueOnce(usage).mockResolvedValueOnce({ id: 'p/1' });
  mocks.open.mockReturnValue(false);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /My project/ }));
  fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Project is busy');
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'common.confirm' })).toBeEnabled();
});
