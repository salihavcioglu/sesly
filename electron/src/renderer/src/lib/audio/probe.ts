import { createObjectUrl, revokeObjectUrl } from './object-url';

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Duration of an audio file in seconds via `<audio>` metadata, or null when
 * the browser cannot decode it (or reports a non-finite duration, as Chromium
 * does for MediaRecorder WebM without a duration header).
 */
export function probeAudioDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = createObjectUrl(file);
    if (!url || typeof Audio === 'undefined') {
      resolve(null);
      return;
    }
    const audio = new Audio();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      revokeObjectUrl(url);
      resolve(value);
    };
    timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    audio.addEventListener(
      'loadedmetadata',
      () => finish(Number.isFinite(audio.duration) ? audio.duration : null),
      { once: true },
    );
    audio.addEventListener('error', () => finish(null), { once: true });
    audio.preload = 'metadata';
    audio.src = url;
  });
}
