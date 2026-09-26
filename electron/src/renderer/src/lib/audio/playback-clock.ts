import { Store } from '@tanstack/store';
import { useStore } from '@tanstack/react-store';

interface SeekRequest {
  id: number;
  time: number;
  play?: boolean;
  end?: number;
}

interface PlaybackClock {
  time: number;
  duration: number;
  seek?: SeekRequest;
}

const clocks = new Store<Record<string, PlaybackClock>>({});
let seekId = 0;

const emptyClock: PlaybackClock = { time: 0, duration: 0 };

export function publishPlaybackClock(source: string, time: number, duration: number): void {
  const current = clocks.state[source];
  const nextTime = Number.isFinite(time) && time >= 0 ? time : 0;
  const nextDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (current?.time === nextTime && current.duration === nextDuration) return;
  clocks.setState((state) => ({
    ...state,
    [source]: { ...current, time: nextTime, duration: nextDuration },
  }));
}

export function requestPlaybackSeek(source: string, time: number): void {
  if (!Number.isFinite(time)) return;
  const current = clocks.state[source] || emptyClock;
  const target = Math.max(0, Math.min(time, current.duration || time));
  clocks.setState((state) => ({
    ...state,
    [source]: {
      ...current,
      time: target,
      seek: { id: ++seekId, time: target },
    },
  }));
}

export function requestPlaybackRange(source: string, start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const current = clocks.state[source] || emptyClock;
  const target = Math.max(0, Math.min(start, current.duration || start));
  const rangeEnd = Math.max(target, Math.min(end, current.duration || end));
  clocks.setState((state) => ({
    ...state,
    [source]: {
      ...current,
      time: target,
      seek: { id: ++seekId, time: target, play: true, end: rangeEnd },
    },
  }));
}

export function resetPlaybackClock(source: string): void {
  if (!clocks.state[source]) return;
  clocks.setState((state) => {
    const next = { ...state };
    delete next[source];
    return next;
  });
}

export function usePlaybackClock(source: string): PlaybackClock {
  return useStore(clocks, (state) => state[source] || emptyClock);
}

export function usePlaybackSeek(source: string): SeekRequest | undefined {
  return useStore(clocks, (state) => state[source]?.seek);
}
