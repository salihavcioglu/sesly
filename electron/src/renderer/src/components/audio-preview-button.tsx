import { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, LoaderCircleIcon, CircleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  StudioMediaPlayer,
  audioSource,
  audioLoaders,
  MediaProvider,
  useMediaState,
  type MediaPlayerInstance,
} from './media-player';
import { Button } from './ui/button';
import { beginAppActivity, type AppActivityKind } from '@/lib/app-activity';
interface PreviewProps {
  src: string;
  source: string;
  fallbackSrc?: string;
  activity?: AppActivityKind;
  onReady?: () => void;
  disabled?: boolean;
  disabledLabel?: string;
}
export function AudioPreviewButton(props: PreviewProps) {
  return <PreviewPlayer key={props.source + ':' + props.src} {...props} />;
}
function PreviewPlayer({
  src,
  source,
  fallbackSrc,
  activity,
  onReady,
  disabled,
  disabledLabel,
}: PreviewProps) {
  const [fallback, setFallback] = useState(false);
  const retried = useRef(false);
  const resolved = fallback && fallbackSrc ? fallbackSrc : src;
  const player = useRef<MediaPlayerInstance>(null);
  return (
    <StudioMediaPlayer
      key={resolved}
      playerRef={player}
      sourceKey={source}
      src={audioSource(resolved)}
      viewType="audio"
      load={fallback ? 'eager' : 'play'}
      autoPlay={fallback}
      onError={() => {
        if (!retried.current && fallbackSrc && fallbackSrc !== src) {
          retried.current = true;
          setFallback(true);
        }
      }}
      className="inline-flex"
    >
      <MediaProvider loaders={audioLoaders} className="hidden" />
      <PreviewControl
        player={player}
        activity={activity}
        onReady={onReady}
        disabled={disabled}
        disabledLabel={disabledLabel}
      />
    </StudioMediaPlayer>
  );
}
function PreviewControl({
  player,
  activity,
  onReady,
  disabled,
  disabledLabel,
}: {
  player: React.RefObject<MediaPlayerInstance | null>;
  activity?: AppActivityKind;
  onReady?: () => void;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const { t } = useTranslation();
  const paused = useMediaState('paused');
  const mediaError = useMediaState('error');
  const waiting = useMediaState('waiting');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = pending || waiting;
  const error = failed || Boolean(mediaError);
  const label =
    disabled && disabledLabel
      ? disabledLabel
      : t(
          error
            ? 'player.unavailable'
            : busy
              ? 'common.loading'
              : paused
                ? 'clone.preview_voice'
                : 'player.pause',
        );
  const toggle = async () => {
    setFailed(false);
    if (!paused) {
      await player.current?.pause();
      return;
    }
    setPending(true);
    const finishActivity = activity ? beginAppActivity(activity) : null;
    try {
      await player.current?.play();
      if (mounted.current) onReady?.();
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      finishActivity?.();
      if (mounted.current) setPending(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      aria-pressed={!paused}
      aria-busy={busy}
      disabled={disabled || pending}
      onClick={() => void toggle()}
    >
      {error ? (
        <CircleAlertIcon className="text-destructive" />
      ) : busy ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : paused ? (
        <PlayIcon />
      ) : (
        <PauseIcon />
      )}
    </Button>
  );
}
