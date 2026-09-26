import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  saveAudio: vi.fn(() => Promise.resolve({ canceled: true })),
  revealPath: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { saveAudio: mock.saveAudio, revealPath: mock.revealPath } }),
}));
vi.mock('@/components/waveform-player', () => ({ WaveformPlayer: () => <div>player</div> }));
vi.mock('@/hooks/use-profiles', () => ({ useProfiles: () => ({ data: [] }) }));
vi.mock('@/hooks/use-generate', () => ({ useGenerateClone: () => ({ isGenerating: false }) }));
vi.mock('@/lib/api/client', () => ({ audioUrl: (path: string) => `/audio/${path}` }));
vi.mock('@/lib/store/takes', () => ({
  reuseTake: vi.fn(),
  takeSettings: () => ({}),
}));
vi.mock('./save-take-profile', () => ({ SaveTakeProfile: () => <div>save profile</div> }));
vi.mock('./lock-voice', () => ({ LockVoice: () => <div>lock</div> }));

import { TakeDetails } from './take-details';

it('exports a historical take through the native save dialog', async () => {
  render(
    <TakeDetails
      item={
        {
          id: 'take-42',
          text: 'Historical line',
          audio_path: 'history/take-42.wav',
          language: 'English',
        } as never
      }
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'clone.download' }));
  await waitFor(() =>
    expect(mock.saveAudio).toHaveBeenCalledWith({
      url: '/audio/history/take-42.wav',
      suggestedName: 'sesly-take-42.wav',
    }),
  );
});
