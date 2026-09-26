import { describe, expect, it, vi } from 'vitest';
import { installPreloadRecovery } from './preload-recovery';

function harness() {
  const target = new EventTarget();
  const values = new Map<string, string>();
  const reload = vi.fn();
  let healthy: (() => void) | undefined;
  installPreloadRecovery({
    target,
    url: () => 'http://localhost/#/dub',
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    reload,
    schedule: (callback) => {
      healthy = callback;
    },
  });
  return { target, reload, markHealthy: () => healthy?.() };
}

describe('preload recovery', () => {
  it('reloads once for a stale lazy chunk and prevents a reload loop', () => {
    const { target, reload } = harness();
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();

    const repeated = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(repeated);
    expect(repeated.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('allows recovery again after the reloaded app stays healthy', () => {
    const { target, reload, markHealthy } = harness();
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    markHealthy();
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
