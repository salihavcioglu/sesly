/** Match desktop/browser language tags to a bundled translation. */
export function matchLocale<T extends string>(
  value: string | null | undefined,
  supported: readonly T[],
): T | null {
  if (!value) return null;
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(value.trim().replaceAll('_', '-'));
  } catch {
    return null;
  }
  const exact = supported.find((item) => item.toLowerCase() === locale.baseName.toLowerCase());
  if (exact) return exact;
  if (locale.language === 'zh') {
    const traditional = locale.script
      ? locale.script === 'Hant'
      : ['TW', 'HK', 'MO'].includes(locale.region ?? '');
    return supported.find((item) => item === (traditional ? 'zh-TW' : 'zh-CN')) ?? null;
  }
  return supported.find((item) => item === locale.language) ?? null;
}
