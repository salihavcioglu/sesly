import { apiFetch } from './client';

const DEFAULT_CLEAN_FILENAME = 'recording_clean.wav';

/** Denoise a recording through the backend. Resolves to a WAV File named per X-Clean-Filename. */
export async function cleanAudio(
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
): Promise<File> {
  const form = new FormData();
  form.append('audio', blob, filename);
  const res = await apiFetch('/clean-audio', { method: 'POST', body: form, signal });
  const clean = await res.blob();
  const name = res.headers.get('X-Clean-Filename') || DEFAULT_CLEAN_FILENAME;
  return new File([clean], name, { type: 'audio/wav' });
}
