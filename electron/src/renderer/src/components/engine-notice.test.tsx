import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { EngineNotice } from './engine-notice';

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  jobs: {
    data: {
      jobs: [] as { repo_id: string; target?: string; state: string }[],
    },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('sonner', () => ({ toast: { success: mock.toast } }));
vi.mock('@/hooks/use-tts-readiness', () => ({
  useTtsReadiness: () => 'engine',
}));
vi.mock('@/hooks/use-model-install-sync', () => ({
  useModelInstallJobs: () => mock.jobs,
  modelInstallJobTarget: (job: { target?: string }) => job.target || 'local',
  TERMINAL_MODEL_INSTALL_STATES: new Set(['done', 'failed', 'cancelled', 'install_cancelled']),
}));
vi.mock('@/lib/api/client', () => ({
  apiJson: mock.api,
  describeError: String,
}));

function renderNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EngineNotice />
    </QueryClientProvider>,
  );
}

function renderCompactNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EngineNotice operation="design" compact />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mock.api.mockReset();
  mock.toast.mockReset();
  mock.jobs.data.jobs = [];
});

it('installs the required TTS model without sending the user through Settings', async () => {
  mock.api
    .mockResolvedValueOnce({
      target: 'local',
      models: [
        {
          repo_id: 'k2-fsa/OmniVoice',
          role: 'TTS',
          required: true,
          installed: false,
        },
      ],
    })
    .mockResolvedValueOnce({});
  renderNotice();

  fireEvent.click(screen.getByRole('button', { name: 'repairAgent.fix' }));

  await waitFor(() =>
    expect(mock.api).toHaveBeenLastCalledWith('/models/install', {
      method: 'POST',
      body: JSON.stringify({ repo_id: 'k2-fsa/OmniVoice', target: 'local' }),
    }),
  );
  expect(mock.toast).toHaveBeenCalled();
});

it('hands an unexplained readiness failure to the default repair agent', async () => {
  mock.api
    .mockResolvedValueOnce({
      target: 'local',
      models: [
        {
          repo_id: 'k2-fsa/OmniVoice',
          role: 'TTS',
          required: true,
          installed: true,
        },
      ],
    })
    .mockResolvedValueOnce({ tts: { active: null, backends: [] } });
  const listener = vi.fn();
  window.addEventListener('sesly:repair-agent-open', listener);
  renderNotice();

  fireEvent.click(screen.getByRole('button', { name: 'repairAgent.fix' }));

  await waitFor(() => expect(listener).toHaveBeenCalledOnce());
  const event = listener.mock.calls[0]?.[0] as CustomEvent<{
    report: string;
    autoFix: boolean;
  }>;
  expect(event.detail.autoFix).toBe(true);
  expect(event.detail.report).toContain('ACTION_REQUEST');
  window.removeEventListener('sesly:repair-agent-open', listener);
});

it('selects an installed compatible engine without opening Settings or an agent', async () => {
  mock.api.mockImplementation((path: string) => {
    if (path === '/setup/recommendations')
      return Promise.resolve({
        target: 'local',
        models: [
          {
            repo_id: 'k2-fsa/OmniVoice',
            role: 'TTS',
            required: true,
            installed: true,
          },
        ],
      });
    if (path === '/engines')
      return Promise.resolve({
        tts: {
          active: null,
          backends: [{ id: 'omnivoice', available: true, routing_status: 'native' }],
        },
      });
    return Promise.resolve({});
  });
  const listener = vi.fn();
  window.addEventListener('sesly:repair-agent-open', listener);
  renderNotice();

  fireEvent.click(screen.getByRole('button', { name: 'repairAgent.fix' }));

  await waitFor(() =>
    expect(mock.api).toHaveBeenCalledWith('/engines/select', {
      method: 'POST',
      body: JSON.stringify({ family: 'tts', backend_id: 'omnivoice' }),
    }),
  );
  expect(listener).not.toHaveBeenCalled();
  window.removeEventListener('sesly:repair-agent-open', listener);
});

it('joins an existing install instead of submitting the model twice', async () => {
  mock.jobs.data.jobs = [
    {
      repo_id: 'k2-fsa/OmniVoice',
      target: 'local',
      state: 'downloading',
    },
  ];
  mock.api.mockResolvedValue({
    target: 'local',
    models: [
      {
        repo_id: 'k2-fsa/OmniVoice',
        role: 'TTS',
        required: true,
        installed: false,
      },
    ],
  });
  renderNotice();

  fireEvent.click(screen.getByRole('button', { name: 'repairAgent.fix' }));

  await waitFor(() =>
    expect(screen.getByRole('button')).toHaveTextContent('modelMaintenance.downloading'),
  );
  expect(mock.api.mock.calls.filter(([path]) => path === '/models/install')).toHaveLength(0);
});

it('offers the same automatic recovery on compact synthesis surfaces', async () => {
  mock.api
    .mockResolvedValueOnce({
      target: 'local',
      models: [
        {
          repo_id: 'k2-fsa/OmniVoice',
          role: 'TTS',
          required: true,
          installed: false,
        },
      ],
    })
    .mockResolvedValueOnce({});
  renderCompactNotice();

  expect(screen.getByText('engines.none_ready_body')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'repairAgent.fix' }));

  await waitFor(() =>
    expect(mock.api).toHaveBeenCalledWith('/models/install', {
      method: 'POST',
      body: JSON.stringify({ repo_id: 'k2-fsa/OmniVoice', target: 'local' }),
    }),
  );
});
