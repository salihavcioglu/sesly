import { expect, it, vi } from 'vitest';

const pending = vi.hoisted(() => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { wait, finish };
});
vi.mock('./locales/de.json', async () => {
  await pending.wait;
  return { default: { backend: { ready: 'Bereit' } } };
});
vi.mock('./locales/fr.json', async () => {
  throw new Error('locale chunk unavailable');
});

it('keeps the latest language choice when an earlier bundle finishes loading later', async () => {
  localStorage.setItem('sesly.locale', 'en');
  const { default: i18n, setAppLanguage } = await import('./index');
  const earlier = setAppLanguage('de');
  await setAppLanguage('en');
  pending.finish();
  await earlier;
  expect(i18n.language).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  expect(localStorage.getItem('sesly.locale')).toBe('en');
});

it('keeps the current language when a lazy locale chunk cannot load', async () => {
  const { default: i18n, setAppLanguage } = await import('./index');
  await setAppLanguage('en');
  await expect(setAppLanguage('fr')).resolves.toBe(false);
  expect(i18n.language).toBe('en');
  expect(localStorage.getItem('sesly.locale')).toBe('en');
});
