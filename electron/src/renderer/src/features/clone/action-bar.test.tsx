import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { ActionBar } from './action-bar';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const failure = vi.hoisted(() => ({ error: null as string | null }));
const readiness = vi.hoisted(() => ({
  blocker: null as null | 'reference' | 'text' | 'preparing',
}));
vi.mock('@/hooks/use-clone-readiness', () => ({ useCloneReadiness: () => readiness.blocker }));
vi.mock('@/hooks/use-clone-demo', () => ({ useCloneDemo: () => false }));
const generate = vi.fn(() => Promise.resolve());
const cancel = vi.fn();
const setCloneSetting = vi.fn();
const resetOverrides = vi.fn();
const runtime = {
  isGenerating: false,
  elapsedSeconds: 0,
  progress: null as number | null,
  stage: 'preparing',
  modelStage: null as string | null,
  modelProgress: null as number | null,
};

const settings = {
  text: '',
  language: 'Auto',
  refText: '',
  instruct: '',
  steps: 32,
  cfg: 2,
  speed: 1,
  tShift: 0.5,
  posTemp: 1,
  classTemp: 1,
  layerPenalty: 3,
  denoise: false,
  postprocess: true,
  duration: '',
  showOverrides: true,
  selectedProfileId: null,
  autoPlay: true,
};

vi.mock('@/lib/languages', () => ({
  LANGUAGES: ['Auto', 'English'],
  POPULAR_LANGUAGES: ['English'],
  TAGS: [],
}));

vi.mock('@/lib/store/clone-settings', () => ({
  useCloneSettings: () => settings,
  useCloneSetting: (key: keyof typeof settings) => settings[key],
  setCloneSetting: (...args: unknown[]) => setCloneSetting(...args),
  resetOverrides: () => resetOverrides(),
}));

vi.mock('@/lib/audio/playback', () => ({
  usePlaybackSource: () => 'output',
  stopActivePlayback: vi.fn(),
}));

vi.mock('@/hooks/use-generate', () => ({
  useGenerateClone: () => ({
    generate,
    cancel,
    error: failure.error,
    cloneBlocker: readiness.blocker,
    ...runtime,
  }),
}));

describe('ActionBar', () => {
  beforeEach(() => {
    readiness.blocker = null;
    failure.error = null;
    generate.mockClear();
  });
  beforeEach(() => {
    Object.assign(runtime, {
      isGenerating: false,
      elapsedSeconds: 0,
      progress: null,
      stage: 'preparing',
      modelStage: null,
      modelProgress: null,
    });
  });
  it.each(['reference', 'text', 'preparing'] as const)(
    'blocks generation while %s is missing or unfinished',
    (blocker) => {
      readiness.blocker = blocker;
      render(<ActionBar />);
      const button = screen.getByRole('button', { name: 'Synthesize audio' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-describedby');
      fireEvent.click(button);
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it('renders a short backend error once without duplicate diagnostics', () => {
    failure.error = 'LibsndfileError: C:\\private\\outputs\\take.wav';
    const view = render(<ActionBar />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('LibsndfileError');
    expect(view.container.querySelector('details')).not.toBeInTheDocument();
    expect(view.container.querySelector('pre')).not.toBeInTheDocument();
  });
  it('keeps synthesis available while the latest take is playing', () => {
    render(<ActionBar />);
    const button = screen.getByRole('button', { name: 'Synthesize audio' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Stop playback' })).not.toBeInTheDocument();
  });
  it('renders the production overrides with their current values', () => {
    render(<ActionBar />);
    // Base UI exposes the slider root as a labelled group (the thumb input is
    // only materialised with layout, which jsdom lacks).
    expect(screen.getByRole('group', { name: 'Steps' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'CFG' })).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Postprocess' })).toBeChecked();
    expect(screen.getByText('1.0×')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(resetOverrides).toHaveBeenCalled();
  });

  it('calls generate from the primary action', () => {
    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Synthesize audio' }));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('keeps the action fixed while showing the real model-loading phase and progress', () => {
    Object.assign(runtime, {
      isGenerating: true,
      elapsedSeconds: 3.4,
      stage: 'loading',
      modelStage: 'compiling',
      modelProgress: 62,
    });
    render(<ActionBar />);

    expect(screen.getByRole('button', { name: 'Optimizing model…' })).toHaveClass('w-52');
    expect(screen.getByText('62% · 3.4s')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
  });
});

vi.mock('@/hooks/use-engines', () => ({ useEngines: () => ({ activeTts: null }) }));
