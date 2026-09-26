import { describe, expect, it } from 'vitest';
import { resolvePerformanceModelPack } from './performance-model-packs';
import type { CatalogueModel } from './model-catalogue-query';

const model = (
  repo_id: string,
  size_gb: number,
  installed = false,
  supported = true,
): CatalogueModel => ({
  repo_id,
  label: repo_id,
  role: 'ASR',
  size_gb,
  installed,
  supported,
});

describe('performance model packs', () => {
  it('uses a small ASR and dictation set for Fast', () => {
    const pack = resolvePerformanceModelPack(
      [
        model('k2-fsa/OmniVoice', 2.4, true),
        model('Systran/faster-whisper-base', 0.15),
        model('csukuangfj/sherpa-onnx-whisper-tiny', 0.104),
        model('facebook/nllb-200-distilled-600M', 2.4),
      ],
      'fast',
    );

    expect(pack.models.map((item) => item.repo_id)).toEqual([
      'k2-fsa/OmniVoice',
      'Systran/faster-whisper-base',
      'csukuangfj/sherpa-onnx-whisper-tiny',
    ]);
    expect(pack.missing).toHaveLength(2);
    expect(pack.downloadGb).toBeCloseTo(0.254);
  });

  it('adds accurate ASR, multilingual dictation fallback, and NLLB for Quality', () => {
    const repos = [
      model('k2-fsa/OmniVoice', 2.4, true),
      model('Systran/faster-whisper-large-v3', 2.9),
      model('csukuangfj/sherpa-onnx-whisper-tiny', 0.104),
      model('csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', 0.67),
      model('facebook/nllb-200-distilled-600M', 2.4),
    ];
    const pack = resolvePerformanceModelPack(repos, 'quality');

    expect(pack.models).toHaveLength(5);
    expect(pack.downloadGb).toBeCloseTo(6.074);
  });

  it('omits models unsupported by the selected compute target', () => {
    const pack = resolvePerformanceModelPack(
      [
        model('k2-fsa/OmniVoice', 2.4, true),
        model('Systran/faster-whisper-base', 0.15, false, false),
        model('csukuangfj/sherpa-onnx-whisper-tiny', 0.104),
      ],
      'fast',
    );

    expect(pack.models.map((item) => item.repo_id)).not.toContain(
      'Systran/faster-whisper-base',
    );
  });
});
