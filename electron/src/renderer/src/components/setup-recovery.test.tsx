import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mounted = vi.hoisted(() => ({
  credentials: vi.fn(),
  network: vi.fn(),
  mirror: vi.fn(),
  media: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/settings/credential-settings', () => ({
  HuggingFaceToken: () => {
    mounted.credentials();
    return <div>Token controls</div>;
  },
}));
vi.mock('@/features/settings/network-settings', () => ({
  NetworkSettings: () => {
    mounted.network();
    return <div>Proxy controls</div>;
  },
}));
vi.mock('@/features/settings/mirror-settings', () => ({
  MirrorSettings: () => {
    mounted.mirror();
    return <div>Mirror controls</div>;
  },
}));
vi.mock('@/features/settings/media-tools', () => ({
  MediaTools: () => {
    mounted.media();
    return <div>Media controls</div>;
  },
}));
import { SetupRecovery } from './setup-recovery';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('keeps recovery controls dormant until expanded and exposes existing repair workflows', async () => {
  render(<SetupRecovery />);
  expect(mounted.credentials).not.toHaveBeenCalled();
  expect(mounted.media).not.toHaveBeenCalled();
  expect(mounted.network).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('settings.credentials'));
  await screen.findByText('Token controls');
  fireEvent.click(screen.getByText('settings.network'));
  await screen.findByText('Proxy controls');
  await screen.findByText('Mirror controls');
  fireEvent.click(screen.getByText('settings.audio_tools'));
  await screen.findByText('Media controls');
});
