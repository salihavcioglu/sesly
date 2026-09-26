const recoveryKey = 'sesly.preload-recovery.v1';

interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PreloadRecoveryOptions {
  target?: EventTarget;
  url?: () => string;
  storage?: RecoveryStorage;
  reload?: () => void;
  schedule?: (callback: () => void, delay: number) => unknown;
}

/** Recover once when Vite reports a stale lazy chunk, then expose repeat failures normally. */
export function installPreloadRecovery(options: PreloadRecoveryOptions = {}) {
  const target = options.target ?? window;
  const url = options.url ?? (() => window.location.href);
  const storage = options.storage ?? window.sessionStorage;
  const reload = options.reload ?? (() => window.location.reload());
  const schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay));

  const onPreloadError = (event: Event) => {
    const current = url();
    try {
      if (storage.getItem(recoveryKey) === current) return;
      storage.setItem(recoveryKey, current);
    } catch {
      // Reload still repairs stale chunks when session storage is unavailable.
    }
    event.preventDefault();
    reload();
  };

  target.addEventListener('vite:preloadError', onPreloadError);
  schedule(() => {
    try {
      if (storage.getItem(recoveryKey) === url()) storage.removeItem(recoveryKey);
    } catch {
      // Storage availability does not affect the running app.
    }
  }, 10_000);

  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
