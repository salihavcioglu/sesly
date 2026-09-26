import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useRecording } from './use-recording';
import { cleanAudio } from '@/lib/api/audio';
import { startSupportedMediaRecorder } from '@/lib/audio/recorder';
vi.mock('@/lib/api/audio', () => ({ cleanAudio: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/audio/recorder', () => ({
  buildAudioInputConstraints: () => ({ audio: true }),
  describeMicError: () => ({ key: 'error' }),
  extensionForMime: () => 'webm',
  listAudioInputs: async () => [],
  startInputLevelMonitor: () => vi.fn(),
  startSupportedMediaRecorder: vi.fn(),
}));
const getUserMedia = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
});
it('releases a microphone granted after navigation without starting a recorder', async () => {
  let grant!: (stream: MediaStream) => void;
  getUserMedia.mockReturnValue(
    new Promise<MediaStream>((resolve) => {
      grant = resolve;
    }),
  );
  const stop = vi.fn();
  const { result, unmount } = renderHook(() => useRecording(vi.fn()));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.start();
  });
  unmount();
  await act(async () => {
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await pending;
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(startSupportedMediaRecorder).not.toHaveBeenCalled();
});
it('does not deliver cleaned audio after its recording view unmounts', async () => {
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  let complete!: (file: File) => void;
  vi.mocked(cleanAudio).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  vi.mocked(startSupportedMediaRecorder).mockImplementation((_stream, callbacks) => ({
    mimeType: 'audio/webm',
    extension: 'webm',
    recorder: {
      state: 'recording',
      stop: () => {
        callbacks.onData(new Blob(['x'.repeat(2000)]));
        callbacks.onStop();
      },
    } as unknown as MediaRecorder,
  }));
  const onRecorded = vi.fn();
  const { result, unmount } = renderHook(() => useRecording(onRecorded));
  await act(async () => {
    await result.current.start();
  });
  act(() => result.current.stop());
  unmount();
  expect(vi.mocked(cleanAudio).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => {
    complete(new File(['clean'], 'clean.wav'));
  });
  expect(onRecorded).not.toHaveBeenCalled();
});
