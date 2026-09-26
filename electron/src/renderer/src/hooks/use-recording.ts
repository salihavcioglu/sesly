import { setRecordingBusy } from '@/lib/store/reference';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { throttle } from '@tanstack/react-pacer';
import { toast } from 'sonner';
import { cleanAudio } from '@/lib/api/audio';
import {
  buildAudioInputConstraints,
  describeMicError,
  extensionForMime,
  listAudioInputs,
  startInputLevelMonitor,
  startSupportedMediaRecorder,
  type ChannelMode,
} from '@/lib/audio/recorder';
import { tr } from '@/lib/i18n-text';
import { beginAppActivity } from '@/lib/app-activity';

export type { ChannelMode } from '@/lib/audio/recorder';

/** Below this the blob is a click, not speech — MediaRecorder headers alone are a few hundred bytes. */
const MIN_RECORDING_BYTES = 1000;
const TIMER_TICK_MS = 100;
const LEVEL_THROTTLE_MS = 50;

export interface UseRecording {
  isRecording: boolean;
  isStarting: boolean;
  isCleaning: boolean;
  seconds: number;
  inputs: MediaDeviceInfo[];
  selectedInputId: string;
  setSelectedInputId: (id: string) => void;
  channelMode: ChannelMode;
  setChannelMode: (mode: ChannelMode) => void;
  /** Microphone RMS level, 0..1. */
  level: number;
  start(): Promise<void>;
  stop(): void;
}

/**
 * Microphone recording → backend denoise → `onRecorded(file)`. Falls back to
 * the raw recording when `/clean-audio` is unavailable so a missing denoiser
 * never blocks cloning.
 */
export function useRecording(
  onRecorded: (file: File) => void,
  trackReference = true,
): UseRecording {
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const finishActivity = useRef<(() => void) | null>(null);
  useEffect(() => {
    const busy = isRecording || isStarting || isCleaning;
    if (busy && !finishActivity.current) finishActivity.current = beginAppActivity('recording');
    if (!busy && finishActivity.current) {
      finishActivity.current();
      finishActivity.current = null;
    }
  }, [isRecording, isStarting, isCleaning]);
  useEffect(
    () => () => {
      finishActivity.current?.();
      finishActivity.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!trackReference) return;
    setRecordingBusy(isRecording || isStarting || isCleaning);
    return () => setRecordingBusy(false);
  }, [isRecording, isStarting, isCleaning, trackReference]);
  const [seconds, setSeconds] = useState(0);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState('');
  const [channelMode, setChannelMode] = useState<ChannelMode>('auto');
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopLevelRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);
  const lifecycle = useRef(0);
  const cleaningRequest = useRef<AbortController | null>(null);

  // 60 fps analyser samples would re-render the whole form; ~20 fps is plenty for a meter.
  const publishLevel = useMemo(
    () => throttle((value: number) => setLevel(value), { wait: LEVEL_THROTTLE_MS }),
    [],
  );

  const refreshInputs = useCallback(async () => {
    try {
      const devices = await listAudioInputs();
      setInputs(devices);
      setSelectedInputId((current) =>
        current && !devices.some((device) => device.deviceId === current) ? '' : current,
      );
    } catch {
      setInputs([]);
    }
  }, []);

  const stopLevelMonitor = useCallback(() => {
    stopLevelRef.current?.();
    stopLevelRef.current = null;
    setLevel(0);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    void refreshInputs();
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    const onChange = (): void => void refreshInputs();
    mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      lifecycle.current++;
      cleaningRequest.current?.abort();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      mediaDevices?.removeEventListener?.('devicechange', onChange);
      stopLevelRef.current?.();
      clearTimer();
      releaseStream();
    };
  }, [refreshInputs, clearTimer, releaseStream]);

  const finishRecording = useCallback(
    async (blob: Blob, extension: string) => {
      clearTimer();
      stopLevelMonitor();
      releaseStream();
      recorderRef.current = null;
      setIsRecording(false);
      if (blob.size < MIN_RECORDING_BYTES) {
        toast.error(tr('recording.too_short'));
        return;
      }
      const generation = lifecycle.current;
      const request = new AbortController();
      cleaningRequest.current = request;
      const filename = `recording.${extension}`;
      setIsCleaning(true);
      try {
        const clean = await cleanAudio(blob, filename, request.signal);
        if (generation !== lifecycle.current || request.signal.aborted) return;
        onRecordedRef.current(clean);
        toast.success(tr('recording.cleaned_loaded'));
      } catch {
        if (generation !== lifecycle.current || request.signal.aborted) return;
        onRecordedRef.current(new File([blob], filename, { type: blob.type }));
        toast.success(tr('recording.loaded_raw'));
      } finally {
        if (cleaningRequest.current === request) cleaningRequest.current = null;
        if (generation === lifecycle.current) setIsCleaning(false);
      }
    },
    [clearTimer, stopLevelMonitor, releaseStream],
  );

  const start = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return;
    const generation = lifecycle.current;
    startingRef.current = true;
    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        buildAudioInputConstraints(selectedInputId, channelMode),
      );
      if (generation !== lifecycle.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // Labels are only populated once a stream has been granted.
      void refreshInputs();
      stopLevelMonitor();
      try {
        stopLevelRef.current = startInputLevelMonitor(stream, publishLevel);
      } catch {
        // The meter is optional; recording must still work without Web Audio.
        stopLevelRef.current = null;
      }

      const chunks: Blob[] = [];
      let format = { mimeType: 'audio/webm', extension: 'webm' };
      const started = startSupportedMediaRecorder(stream, {
        onData: (chunk) => {
          if (chunk.type)
            format = { mimeType: chunk.type, extension: extensionForMime(chunk.type) };
          chunks.push(chunk);
        },
        onStop: () => {
          if (generation !== lifecycle.current) return;
          void finishRecording(new Blob(chunks, { type: format.mimeType }), format.extension);
        },
      });
      if (!started) {
        stopLevelMonitor();
        releaseStream();
        toast.error(tr('recording.recorder_unsupported'));
        return;
      }
      format = { mimeType: started.mimeType, extension: started.extension };
      recorderRef.current = started.recorder;
      setSeconds(0);
      setIsRecording(true);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setSeconds(Math.round((Date.now() - startedAt) / TIMER_TICK_MS) / 10);
      }, TIMER_TICK_MS);
    } catch (err) {
      if (generation !== lifecycle.current) return;
      stopLevelMonitor();
      releaseStream();
      const { key, params } = describeMicError(err);
      toast.error(tr(key, params), { duration: 6000 });
    } finally {
      startingRef.current = false;
      if (generation === lifecycle.current) setIsStarting(false);
    }
  }, [
    selectedInputId,
    channelMode,
    refreshInputs,
    stopLevelMonitor,
    releaseStream,
    publishLevel,
    finishRecording,
  ]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); // onstop → finishRecording
    } else {
      recorderRef.current = null;
      clearTimer();
      releaseStream();
    }
    stopLevelMonitor();
    setIsRecording(false);
  }, [clearTimer, releaseStream, stopLevelMonitor]);

  return {
    isRecording,
    isStarting,
    isCleaning,
    seconds,
    inputs,
    selectedInputId,
    setSelectedInputId,
    channelMode,
    setChannelMode,
    level,
    start,
    stop,
  };
}
