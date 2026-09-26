import i18next from 'i18next';

/**
 * `i18next.t` for non-component code. Before `init()` runs (unit tests, a
 * crash before the i18n bootstrap) `t` returns undefined; fall back to the key
 * so a toast never renders as "undefined".
 */
export function tr(key: string, options?: Record<string, unknown>): string {
  const value: unknown = options ? i18next.t(key, options) : i18next.t(key);
  return typeof value === 'string' && value ? value : key;
}
