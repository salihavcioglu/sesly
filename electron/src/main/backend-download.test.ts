import { describe, expect, it } from 'vitest';
import { resolveBackendDownloadUrl } from './backend-download';

describe('native backend downloads', () => {
  const backend = 'https://voicebox.example:3900';

  it('resolves renderer API paths and packaged app URLs against the active backend', () => {
    expect(resolveBackendDownloadUrl('/api/audio/take.wav', backend)).toBe(
      'https://voicebox.example:3900/audio/take.wav',
    );
    expect(resolveBackendDownloadUrl('app://sesly/api/personas/export/voice', backend)).toBe(
      'https://voicebox.example:3900/personas/export/voice',
    );
  });

  it('accepts absolute URLs only from the active backend origin', () => {
    expect(resolveBackendDownloadUrl(`${backend}/exports/take.wav`, backend)).toBe(
      `${backend}/exports/take.wav`,
    );
    expect(() => resolveBackendDownloadUrl('https://attacker.example/take.wav', backend)).toThrow(
      'active Sesly backend',
    );
    expect(() => resolveBackendDownloadUrl('file:///tmp/take.wav', backend)).toThrow(
      'active Sesly backend',
    );
  });
});
