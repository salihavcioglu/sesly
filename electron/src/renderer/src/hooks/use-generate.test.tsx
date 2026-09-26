import { toast } from 'sonner';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationProvider, useGenerateClone } from './use-generate';
import { patchCloneSettings } from '@/lib/store/clone-settings';
import { generateClone } from '@/lib/api/generate';
import { setLatestOutput } from '@/lib/store/output';
const modelStatus = vi.hoisted(() => ({
  value: { status: 'loading', loading: true } as {
    status: string;
    loading: boolean;
    sub_stage?: string;
    progress?: number;
  },
}));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiJson: vi.fn().mockImplementation(() => Promise.resolve(modelStatus.value)),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('./use-clone-readiness', () => ({ useCloneInputsReadiness: () => null }));
vi.mock('./use-tts-readiness', () => ({ useTtsReadiness: () => null }));
vi.mock('@/lib/api/generate', () => ({
  generateClone: vi.fn(),
  sanitizeInstruct: () => ({ instruct: '', unsupported: [], duplicates: [], conflicts: [] }),
}));
vi.mock('@/lib/store/output', () => ({ setLatestOutput: vi.fn() }));
function Consumer({ name }: { name: string }) {
  const state = useGenerateClone();
  return (
    <>
      <button onClick={() => void state.generate()}>
        {name}:{state.isGenerating ? 'running' : 'idle'}
      </button>
      <span data-testid={name + '-stage'}>{state.stage}</span>
      <span data-testid={name + '-model-stage'}>{state.modelStage}</span>
      <span data-testid={name + '-model-progress'}>{state.modelProgress}</span>
    </>
  );
}
describe('shared generation lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelStatus.value = { status: 'loading', loading: true };
  });
  it('keeps failures inline without a duplicate toast', async () => {
    patchCloneSettings({ text: 'Hello', selectedProfileId: 'voice-1', autoPlay: false });
    vi.mocked(generateClone).mockRejectedValueOnce(new Error('write failed'));
    function ErrorConsumer() {
      const state = useGenerateClone();
      return (
        <>
          <button onClick={() => void state.generate()}>retry test</button>
          <span>{state.error}</span>
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GenerationProvider>
          <ErrorConsumer />
        </GenerationProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('retry test'));
    await screen.findByText('write failed');
    expect(toast.error).not.toHaveBeenCalled();
    vi.mocked(generateClone).mockClear();
  });
  it('shares progress across consumers and survives a view unmount', async () => {
    patchCloneSettings({ text: 'Hello', selectedProfileId: 'voice-1', autoPlay: false });
    let complete!: (value: unknown) => void;
    vi.mocked(generateClone).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve as (value: unknown) => void;
        }),
    );
    const client = new QueryClient();
    const tree = (editor: boolean) => (
      <QueryClientProvider client={client}>
        <GenerationProvider>
          {editor && <Consumer name="editor" />}
          <Consumer name="composer" />
        </GenerationProvider>
      </QueryClientProvider>
    );
    const view = render(tree(true));
    fireEvent.click(screen.getByText('editor:idle'));
    await screen.findByText('composer:running');
    await waitFor(() => expect(screen.getByTestId('composer-stage')).toHaveTextContent('loading'));
    act(() => {
      vi.mocked(generateClone).mock.calls[0]?.[1]?.onProgress?.(25);
    });
    await waitFor(() =>
      expect(screen.getByTestId('composer-stage')).toHaveTextContent('receiving'),
    );
    view.rerender(tree(false));
    expect(vi.mocked(generateClone).mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    const result = {
      blob: new Blob(),
      id: 'take-1',
      audioPath: 'take.wav',
      durationSeconds: 1,
      genTimeSeconds: 1,
      seed: 1,
      routing: null,
      dropped: null,
    };
    await act(async () => {
      complete(result);
    });
    await waitFor(() => expect(screen.getByText('composer:idle')).toBeInTheDocument());
    expect(generateClone).toHaveBeenCalledTimes(1);
    expect(setLatestOutput).toHaveBeenCalledWith(result, 'Hello');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('surfaces the backend model-loading sub-stage and progress', async () => {
    patchCloneSettings({ text: 'Hello', selectedProfileId: 'voice-1', autoPlay: false });
    modelStatus.value = {
      status: 'loading',
      loading: true,
      sub_stage: 'compiling',
      progress: 62,
    };
    let complete!: (value: unknown) => void;
    vi.mocked(generateClone).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve as (value: unknown) => void;
        }),
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <GenerationProvider>
          <Consumer name="runtime" />
        </GenerationProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('runtime:idle'));

    try {
      await waitFor(() =>
        expect(screen.getByTestId('runtime-model-stage')).toHaveTextContent('compiling'),
      );
      expect(screen.getByTestId('runtime-model-progress')).toHaveTextContent('62');
    } finally {
      await act(async () => {
        complete({
          blob: new Blob(),
          id: 'take-2',
          audioPath: 'take.wav',
          durationSeconds: 1,
          genTimeSeconds: 1,
          seed: 1,
          routing: null,
          dropped: null,
        });
      });
    }
  });
});

it('design generation ignores a selected clone profile and sends its own script and seed', async () => {
  patchCloneSettings({ text: 'Clone script', selectedProfileId: 'clone-profile', autoPlay: false });
  vi.mocked(generateClone).mockClear().mockRejectedValueOnce(new Error('stop after request'));
  function DesignConsumer() {
    const state = useGenerateClone();
    return (
      <>
        <button
          onClick={() =>
            void state.generateDesign({ text: 'Design script', instruct: 'male', seed: 42 })
          }
        >
          design test
        </button>
        <span>{state.error}</span>
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GenerationProvider>
        <DesignConsumer />
      </GenerationProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('design test'));
  await screen.findByText('stop after request');
  expect(generateClone).toHaveBeenCalledWith(
    expect.objectContaining({
      text: 'Design script',
      seed: 42,
      profileId: null,
      refAudio: null,
      refText: undefined,
    }),
    expect.anything(),
  );
});

it('attributes generation to an explicitly selected designed voice', async () => {
  vi.mocked(generateClone).mockClear().mockRejectedValueOnce(new Error('stop after request'));
  function DesignConsumer() {
    const state = useGenerateClone();
    return (
      <>
        <button
          onClick={() =>
            void state.generateDesign({
              text: 'Profile script',
              instruct: 'female',
              seed: 7,
              profileId: 'design-profile',
            })
          }
        >
          profile design test
        </button>
        <span>{state.error}</span>
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GenerationProvider>
        <DesignConsumer />
      </GenerationProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('profile design test'));
  await screen.findByText('stop after request');
  expect(generateClone).toHaveBeenCalledWith(
    expect.objectContaining({ profileId: 'design-profile', text: 'Profile script', seed: 7 }),
    expect.anything(),
  );
});
