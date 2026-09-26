import type { CatalogueModel } from './model-catalogue-query';
import type { PerformanceTier } from '@/hooks/use-performance-profile';

const OMNIVOICE = 'k2-fsa/OmniVoice';
const WHISPER_BASE = 'Systran/faster-whisper-base';
const WHISPER_TURBO = 'deepdml/faster-whisper-large-v3-turbo-ct2';
const WHISPER_LARGE = 'Systran/faster-whisper-large-v3';
const SHERPA_TINY = 'csukuangfj/sherpa-onnx-whisper-tiny';
const SHERPA_PARAKEET = 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8';
const NLLB = 'facebook/nllb-200-distilled-600M';

export const performancePackRepos: Record<PerformanceTier, readonly string[]> = {
  fast: [OMNIVOICE, WHISPER_BASE, SHERPA_TINY],
  balanced: [OMNIVOICE, WHISPER_TURBO, SHERPA_TINY, SHERPA_PARAKEET],
  quality: [OMNIVOICE, WHISPER_LARGE, SHERPA_TINY, SHERPA_PARAKEET, NLLB],
  max: [OMNIVOICE, WHISPER_LARGE, SHERPA_TINY, SHERPA_PARAKEET, NLLB],
};

export interface PerformanceModelPack {
  tier: PerformanceTier;
  models: CatalogueModel[];
  missing: CatalogueModel[];
  totalGb: number;
  downloadGb: number;
}

/** Resolve a pack against the target catalogue so unsupported host models never download. */
export function resolvePerformanceModelPack(
  models: CatalogueModel[],
  tier: PerformanceTier,
): PerformanceModelPack {
  const byRepo = new Map(models.map((model) => [model.repo_id, model]));
  const selected = performancePackRepos[tier]
    .map((repoId) => byRepo.get(repoId))
    .filter((model): model is CatalogueModel => Boolean(model?.supported));
  const missing = selected.filter((model) => !model.installed);
  return {
    tier,
    models: selected,
    missing,
    totalGb: selected.reduce((total, model) => total + model.size_gb, 0),
    downloadGb: missing.reduce((total, model) => total + model.size_gb, 0),
  };
}
