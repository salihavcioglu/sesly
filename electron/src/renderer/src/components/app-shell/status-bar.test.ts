import { describe, expect, it } from 'vitest';
import type { EnginesResponse } from '@/lib/api/types';
import { engineFamilyState } from '@/hooks/use-engines';
import { resolveRemoteRuntime, resolveRuntimeHealth } from './status-runtime';

const engines = (available = true): EnginesResponse => ({
  tts: {
    active: 'omnivoice',
    active_model: 'k2-fsa/OmniVoice',
    backends: [
      {
        id: 'omnivoice',
        display_name: 'Sesly',
        available,
        reason: available ? null : 'Model missing',
      },
    ],
  },
  asr: { active: null, backends: [] },
  llm: { active: null, backends: [] },
});

describe('sidebar runtime health', () => {
  it('tolerates individual engine families missing from a partial response', () => {
    const partial = { tts: engines().tts } as EnginesResponse;
    expect(engineFamilyState(partial, 'tts')?.active).toBe('omnivoice');
    expect(engineFamilyState(partial, 'asr')).toBeUndefined();
  });

  it('distinguishes engine discovery, unavailable TTS, real loading, and readiness', () => {
    expect(resolveRuntimeHealth(undefined, true, false, undefined)).toBe('checking');
    expect(resolveRuntimeHealth(engines(false), false, false, { status: 'idle' })).toBe(
      'unavailable',
    );
    expect(
      resolveRuntimeHealth(engines(), false, false, {
        status: 'loading',
        sub_stage: 'loading_weights',
      }),
    ).toBe('loading');
    expect(resolveRuntimeHealth(engines(), false, false, { status: 'ready' })).toBe('ready');
  });

  it('does not present a model-load error as ready', () => {
    expect(
      resolveRuntimeHealth(engines(), false, false, {
        status: 'idle',
        sub_stage: 'error',
        error: 'Could not load weights',
      }),
    ).toBe('unavailable');
  });

  it('treats an incomplete engine response as unavailable', () => {
    expect(
      resolveRuntimeHealth(
        { asr: { active: null, backends: [] } } as unknown as EnginesResponse,
        false,
        false,
        undefined,
      ),
    ).toBe('unavailable');
  });

  it("uses the selected remote worker's actual model readiness", () => {
    const runtime = {
      target: 'worker-1',
      remote: true,
      label: 'Studio GPU',
      reason: 'chosen',
      models: [
        {
          engine: 'omnivoice',
          model_id: 'omnivoice:default',
          supported: true,
          installed: true,
          downloaded: true,
          resident: false,
        },
      ],
    };

    expect(resolveRemoteRuntime(runtime, false, false, false).state).toBe('idle');
    expect(
      resolveRemoteRuntime(
        { ...runtime, models: [{ ...runtime.models[0], resident: true }] },
        false,
        false,
        false,
      ).state,
    ).toBe('ready');
    expect(resolveRemoteRuntime(runtime, false, false, true).state).toBe('working');
  });

  it('never calls an absent or undownloaded remote model ready', () => {
    const runtime = {
      target: 'worker-1',
      remote: true,
      label: 'Studio GPU',
      reason: 'chosen',
      models: [
        {
          engine: 'omnivoice',
          model_id: 'omnivoice:default',
          supported: true,
          installed: true,
          downloaded: false,
          resident: true,
        },
      ],
    };

    expect(resolveRemoteRuntime(runtime, false, false, false).state).toBe('unavailable');
    expect(resolveRemoteRuntime({ ...runtime, models: [] }, false, false, false).state).toBe(
      'unavailable',
    );
  });
});
