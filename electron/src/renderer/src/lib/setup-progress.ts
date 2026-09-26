export const SETUP_IN_PROGRESS_KEY = 'sesly.setup.in-progress.v1';
export const SETUP_COMPLETE_KEY = 'sesly.setup.complete.v1';

export function setupWasStarted(): boolean {
  try {
    // Completion is authoritative if a previous shutdown left both writes
    // behind; returning users must never be trapped in first-run setup.
    return (
      localStorage.getItem(SETUP_COMPLETE_KEY) !== '1' &&
      localStorage.getItem(SETUP_IN_PROGRESS_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function rememberSetupStarted(started: boolean): void {
  try {
    if (started) localStorage.setItem(SETUP_IN_PROGRESS_KEY, '1');
    else localStorage.removeItem(SETUP_IN_PROGRESS_KEY);
  } catch {
    // Hardened browser previews may not expose storage. Component state still
    // keeps the current setup session gated.
  }
}

export function setupWasCompleted(): boolean {
  try {
    return localStorage.getItem(SETUP_COMPLETE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSetupCompleted(): void {
  try {
    localStorage.setItem(SETUP_COMPLETE_KEY, '1');
    localStorage.removeItem(SETUP_IN_PROGRESS_KEY);
  } catch {
    // Component state still completes the current setup session when storage
    // is unavailable in a hardened browser preview.
  }
}

export function forgetSetupProgress(): void {
  try {
    localStorage.removeItem(SETUP_COMPLETE_KEY);
    localStorage.removeItem(SETUP_IN_PROGRESS_KEY);
  } catch {
    // Reset still completes its disk work when browser storage is unavailable.
  }
}
