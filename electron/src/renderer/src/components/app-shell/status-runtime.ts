import type { EnginesResponse } from '@/lib/api/types';
import type { ComputeRuntimeCapability, ComputeRuntimeStatus } from '@/hooks/use-compute-target';

export interface SidebarModelStatus {
  status: 'idle' | 'loading' | 'ready';
  checkpoint?: string | null;
  loaded_at?: string | null;
  sub_stage?: string | null;
  detail?: string | null;
  error?: string | null;
}

export type RuntimeHealth = 'checking' | 'unavailable' | 'loading' | 'ready';

export type RemoteRuntimeState = 'checking' | 'unavailable' | 'working' | 'ready' | 'idle';

export function resolveRemoteRuntime(
  runtime: ComputeRuntimeStatus | undefined,
  pending: boolean,
  failed: boolean,
  working: boolean,
): {
  capability?: ComputeRuntimeCapability;
  state: RemoteRuntimeState;
} {
  if (pending && !runtime) return { state: 'checking' };
  const capability = runtime?.models[0];
  if (
    failed ||
    !runtime?.remote ||
    !capability?.supported ||
    !capability.installed ||
    !capability.downloaded
  ) {
    return { capability, state: 'unavailable' };
  }
  if (working) return { capability, state: 'working' };
  return {
    capability,
    state: capability.resident ? 'ready' : 'idle',
  };
}

export function resolveRuntimeHealth(
  engines: EnginesResponse | undefined,
  enginesLoading: boolean,
  enginesError: boolean,
  model: SidebarModelStatus | undefined,
  modelLoading = false,
  modelError = false,
): RuntimeHealth {
  if (enginesLoading && !engines) return 'checking';
  if (enginesError || !engines) return 'unavailable';
  const tts = (engines as Partial<EnginesResponse>).tts;
  if (!tts || !Array.isArray(tts.backends)) return 'unavailable';
  const selected = tts.backends.find((engine) => engine.id === tts.active);
  if (!selected?.available) return 'unavailable';
  if (selected.id === 'omnivoice' && modelError) return 'unavailable';
  if (selected.id === 'omnivoice' && modelLoading) return 'checking';
  if (selected.id === 'omnivoice' && model?.status === 'loading') return 'loading';
  if (selected.id === 'omnivoice' && (model?.sub_stage === 'error' || model?.error))
    return 'unavailable';
  return 'ready';
}
