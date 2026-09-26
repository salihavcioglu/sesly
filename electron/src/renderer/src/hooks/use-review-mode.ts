import { useSyncExternalStore } from 'react';

export type ReviewMode = 'on' | 'off';

const storageKey = 'sesly.review-mode.v1';
const listeners = new Set<() => void>();

function read(): ReviewMode {
  try {
    return localStorage.getItem(storageKey) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

let current = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setReviewMode(mode: ReviewMode) {
  current = mode;
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    /* The in-memory preference still applies for this session. */
  }
  listeners.forEach((listener) => listener());
}

export function useReviewMode() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
