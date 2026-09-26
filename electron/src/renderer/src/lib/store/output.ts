import { Store } from '@tanstack/store';
import { useStore } from '@tanstack/react-store';
import type { GenerateResult } from '@/lib/api/types';
import { createObjectUrl, revokeObjectUrl } from '@/lib/audio/object-url';

export interface OutputState {
  result: GenerateResult | null;
  /** Object URL for `result.blob`, ready for `<audio src>` / waveform rendering. */
  objectUrl: string | null;
  /** The script that produced `result`. */
  text: string;
}

export const outputStore = new Store<OutputState>({ result: null, objectUrl: null, text: '' });

export function useLatestOutput(): OutputState {
  return useStore(outputStore);
}

export function setLatestOutput(result: GenerateResult, text: string): void {
  revokeObjectUrl(outputStore.state.objectUrl);
  outputStore.setState(() => ({ result, objectUrl: createObjectUrl(result.blob), text }));
}

export function clearLatestOutput(): void {
  revokeObjectUrl(outputStore.state.objectUrl);
  outputStore.setState(() => ({ result: null, objectUrl: null, text: '' }));
}
