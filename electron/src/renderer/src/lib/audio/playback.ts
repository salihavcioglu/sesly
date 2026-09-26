/**
 * Global single-playback manager: only one preview/output plays at a time
 * across the app. Every playback site claims the slot before it starts;
 * claiming stops whatever was playing. The returned `release` is called when
 * the audio ends on its own so the manager never holds a stale handle.
 *
 * Plain module singleton (no React in the core API) so it is usable from
 * non-component code and unit-testable without a DOM.
 */
import { useSyncExternalStore } from 'react';

interface ActivePlayback {
  stop: () => void;
  source: string;
  group?: string;
}

let current: ActivePlayback[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener error must never break playback.
    }
  }
}

/**
 * Register `stop` as the single active playback. Anything playing before is
 * stopped first. Returns `release()` — idempotent, and a no-op once another
 * claim has superseded this one.
 */
export function claimPlayback(stop: () => void, source: string, group?: string): () => void {
  if (!group || current.some((entry) => entry.group !== group)) stopActivePlayback();
  const entry: ActivePlayback = { stop, source, group };
  current.push(entry);
  notify();
  return () => {
    const index = current.indexOf(entry);
    if (index >= 0) {
      current.splice(index, 1);
      notify();
    }
  };
}

/** Stop whatever is playing (no-op when idle). */
export function stopActivePlayback(): void {
  if (!current.length) return;
  const active = current;
  current = []; // cleared first so re-entrant release() calls are no-ops
  for (const { stop } of active) {
    try {
      stop();
    } catch {
      // Already-stopped handles must not throw.
    }
  }
  notify();
}

export function activePlaybackSource(): string | null {
  return current.at(-1)?.source ?? null;
}

export function subscribePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): null {
  return null;
}

/** Source label of the active playback, or null when idle. */
export function usePlaybackSource(): string | null {
  return useSyncExternalStore(subscribePlayback, activePlaybackSource, getServerSnapshot);
}
