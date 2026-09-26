import { APP_ORIGIN } from './protocol';

/**
 * Native saves may carry the active backend's authorization header. Keep every
 * download on that backend so a compromised renderer cannot redirect secrets.
 */
export function resolveBackendDownloadUrl(raw: string, backendBase: string): string {
  const appPrefixed = raw.startsWith(`${APP_ORIGIN}/`) ? raw.slice(APP_ORIGIN.length) : raw;
  const backend = new URL(backendBase);
  const target = appPrefixed.startsWith('/api/')
    ? new URL(`${backendBase.replace(/\/+$/, '')}${appPrefixed.slice('/api'.length)}`)
    : new URL(appPrefixed);
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== backend.origin) {
    throw new Error('Native saves must use the active Sesly backend');
  }
  return target.toString();
}
