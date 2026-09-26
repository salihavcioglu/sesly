import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ open: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { openExternal: mock.open } }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { SupportSettings } from './support-settings';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('points every contact channel at the right destination', () => {
  render(<SupportSettings />);
  expect(screen.getByRole('link', { name: 'contact.security_cta' })).toHaveAttribute(
    'href',
    'https://github.com/salihavcioglu/sesly/security/advisories/new',
  );
  expect(screen.getByRole('link', { name: 'contact.feature_cta' })).toHaveAttribute(
    'href',
    'https://github.com/salihavcioglu/sesly/issues',
  );
  expect(screen.getByRole('link', { name: 'contact.community_cta' })).toHaveAttribute(
    'href',
    'https://github.com/salihavcioglu/sesly/discussions',
  );
});
