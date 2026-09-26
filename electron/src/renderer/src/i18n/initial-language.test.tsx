import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';

const pending = vi.hoisted(() => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { wait, finish };
});
vi.mock('./locales/de.json', async () => {
  await pending.wait;
  return { default: { backend: { ready: 'Lokale Engine bereit' } } };
});
afterEach(cleanup);

it('refreshes the initial fallback after the saved language bundle loads', async () => {
  localStorage.setItem('sesly.locale', 'de');
  const { default: i18n } = await import('./index');
  function Status() {
    const { t } = useTranslation();
    return <span>{t('backend.ready')}</span>;
  }
  render(<Status />);
  expect(screen.getByText('Engine ready')).toBeInTheDocument();
  const loaded = new Promise<void>((resolve) => {
    const listener = (language: string) => {
      if (language === 'de') {
        i18n.store.off('added', listener);
        resolve();
      }
    };
    i18n.store.on('added', listener);
  });
  await act(async () => {
    pending.finish();
    await loaded;
  });
  expect(screen.getByText('Lokale Engine bereit')).toBeInTheDocument();
});
