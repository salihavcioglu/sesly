/** The preload contract, reached through the global augmentation in src/preload/index.d.ts. */
export type SeslyBridge = Window['sesly'];

/** The preload bridge, or null outside Electron (vitest, a plain browser tab). */
export function getBridge(): SeslyBridge | null {
  if (typeof window === 'undefined') return null;
  return 'sesly' in window && window.sesly ? window.sesly : null;
}

export function appVersion(): string {
  return getBridge()?.app.version ?? __APP_VERSION__;
}

export function isMac(): boolean {
  return getBridge()?.app.platform === 'darwin';
}
