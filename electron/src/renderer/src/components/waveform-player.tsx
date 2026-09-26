import { PauseIcon, PlayIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isAudioProvider, type MediaPlayerProps } from '@vidstack/react';
import WaveSurfer from 'wavesurfer.js';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import {
  publishPlaybackClock,
  resetPlaybackClock,
  usePlaybackSeek,
} from '@/lib/audio/playback-clock';
import { cn } from '@/lib/utils';
import {
  StudioMediaPlayer,
  audioSource,
  audioLoaders,
  MediaProvider,
  useMediaState,
  type MediaPlayerInstance,
} from './media-player';

export interface WaveformPlayerProps {
  src: string;
  source?: string;
  loop?: boolean;
  autoPlay?: boolean;
  height?: number;
  showWaveform?: boolean;
  compact?: boolean;
  onEnded?: () => void;
  onCanPlay?: MediaPlayerProps['onCanPlay'];
  playerRef?: React.RefObject<MediaPlayerInstance | null>;
  className?: string;
}
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.floor(safe / 60) + ':' + String(Math.floor(safe % 60)).padStart(2, '0');
}
export function waveColors(el: HTMLElement): { waveColor: string; progressColor: string } {
  const probe = document.createElement('span');
  probe.hidden = true;
  el.appendChild(probe);
  probe.style.color = 'var(--muted-foreground, #a3a3a3)';
  const muted = getComputedStyle(probe).color;
  probe.style.color = 'var(--primary, #4b6ee8)';
  const primary = getComputedStyle(probe).color;
  probe.remove();
  return { waveColor: muted, progressColor: primary };
}

export const WaveformPlayer = memo(function WaveformPlayer({
  src,
  source = 'output',
  loop = false,
  autoPlay = false,
  showWaveform = true,
  height = 44,
  compact = false,
  onEnded,
  onCanPlay,
  playerRef: externalPlayerRef,
  className,
}: WaveformPlayerProps) {
  const localPlayerRef = useRef<MediaPlayerInstance>(null);
  const player = externalPlayerRef ?? localPlayerRef;
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  return (
    <StudioMediaPlayer
      playerRef={player}
      sourceKey={source}
      src={audioSource(src)}
      viewType="audio"
      loop={loop}
      autoPlay={autoPlay}
      load="eager"
      onEnded={onEnded}
      onCanPlay={onCanPlay}
      className={cn(
        'flex min-w-0 items-center rounded-lg bg-muted/40',
        compact ? 'gap-2 px-2 py-1' : 'gap-3 px-3 py-2',
        className,
      )}
      onProviderChange={(provider) => setMedia(isAudioProvider(provider) ? provider.media : null)}
    >
      <MediaProvider loaders={audioLoaders} className="hidden" />
      <WaveformControls
        showWaveform={showWaveform}
        src={src}
        height={height}
        compact={compact}
        media={media}
        player={player}
        source={source}
      />
    </StudioMediaPlayer>
  );
});
function WaveformControls({
  showWaveform,
  src,
  height,
  compact,
  media,
  player,
  source,
}: {
  showWaveform: boolean;
  src: string;
  height: number;
  compact: boolean;
  media: HTMLMediaElement | null;
  player: React.RefObject<MediaPlayerInstance | null>;
  source: string;
}) {
  const { t } = useTranslation();
  const { theme, paletteId } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const waveform = useRef<WaveSurfer | null>(null);
  const rangeEnd = useRef<number | null>(null);
  const [waveReady, setWaveReady] = useState(false);
  const paused = useMediaState('paused');
  const canPlay = useMediaState('canPlay');
  const duration = useMediaState('duration');
  const time = useMediaState('currentTime');
  const error = useMediaState('error');
  const seek = usePlaybackSeek(source);
  useEffect(() => {
    resetPlaybackClock(source);
    return () => resetPlaybackClock(source);
  }, [source, src]);
  useEffect(() => publishPlaybackClock(source, time, duration), [duration, source, time]);
  useEffect(() => {
    if (!seek || !player.current) return;
    player.current.currentTime = seek.time;
    rangeEnd.current = seek.end ?? null;
    if (seek.play) void player.current.play().catch(() => {});
  }, [player, seek]);
  useEffect(() => {
    if (rangeEnd.current == null || time < rangeEnd.current) return;
    rangeEnd.current = null;
    void player.current?.pause().catch(() => {});
  }, [player, time]);
  useEffect(() => {
    setWaveReady(false);
    if (!showWaveform || !container.current || !media) return;
    const ws = WaveSurfer.create({
      container: container.current,
      media,
      url: src,
      height,
      ...waveColors(container.current),
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: false,
    });
    waveform.current = ws;
    ws.on('ready', () => setWaveReady(true));
    ws.on('error', () => setWaveReady(false));
    return () => {
      ws.unAll();
      ws.destroy();
      waveform.current = null;
    };
  }, [media, src, height, showWaveform]);
  useEffect(() => {
    if (container.current) waveform.current?.setOptions(waveColors(container.current));
  }, [theme, paletteId]);
  return (
    <>
      <Button
        type="button"
        size={compact ? 'icon-xs' : 'icon-sm'}
        className="rounded-full"
        disabled={Boolean(error) || !canPlay}
        aria-label={t(paused ? 'player.play' : 'player.pause')}
        aria-pressed={!paused}
        onClick={() => {
          rangeEnd.current = null;
          if (paused) void player.current?.play().catch(() => {});
          else void player.current?.pause();
        }}
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
      </Button>
      {error ? (
        <p role="status" className="flex-1 text-xs text-muted-foreground">
          {t('player.missing')}
        </p>
      ) : (
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div ref={container} className="pointer-events-none" />
          <input
            type="range"
            min={0}
            max={Number.isFinite(duration) && duration > 0 ? duration : 1}
            step="0.01"
            value={Number.isFinite(time) ? time : 0}
            disabled={!duration}
            aria-label={t('player.seek')}
            className={cn(
              'absolute inset-0 h-full w-full cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-primary',
              waveReady && 'opacity-0 focus-visible:opacity-100',
            )}
            onInput={(event) => {
              rangeEnd.current = null;
              if (player.current) player.current.currentTime = Number(event.currentTarget.value);
            }}
          />
        </div>
      )}
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatClock(time)} / {formatClock(duration)}
      </span>
    </>
  );
}
