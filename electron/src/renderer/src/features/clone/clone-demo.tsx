import { useRef } from 'react';
import { CircleAlertIcon, LoaderCircleIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  StudioMediaPlayer,
  MediaProvider,
  audioLoaders,
  audioSource,
  useMediaState,
  type MediaPlayerInstance,
} from '@/components/media-player';
import { Button } from '@/components/ui/button';
import { apiPath } from '@/lib/api/client';

/** The no-model first-run sample occupies the normal synthesis CTA position. */
export function CloneDemoAction() {
  const player = useRef<MediaPlayerInstance>(null);
  return (
    <StudioMediaPlayer
      playerRef={player}
      sourceKey="clone-demo"
      src={audioSource(apiPath('/demo_audio/demo_clone_output.wav'))}
      viewType="audio"
      load="play"
      className="contents"
    >
      <MediaProvider loaders={audioLoaders} className="hidden" />
      <DemoControl player={player} />
    </StudioMediaPlayer>
  );
}

function DemoControl({ player }: { player: React.RefObject<MediaPlayerInstance | null> }) {
  const { t } = useTranslation();
  const paused = useMediaState('paused');
  const waiting = useMediaState('waiting');
  const canPlay = useMediaState('canPlay');
  const error = useMediaState('error');
  const label = t(
    error
      ? 'player.unavailable'
      : waiting
        ? 'common.loading'
        : paused
          ? 'demo.hear_demo'
          : 'demo.stop_demo',
  );

  return (
    <Button
      size="lg"
      className="h-10 w-52 shrink-0 overflow-hidden rounded-lg px-4 shadow-sm transition-colors"
      aria-label={label}
      aria-pressed={!paused}
      aria-busy={waiting}
      disabled={Boolean(error)}
      onClick={() => {
        if (paused) void player.current?.play().catch(() => {});
        else void player.current?.pause();
      }}
    >
      {error ? (
        <CircleAlertIcon />
      ) : waiting && !canPlay ? (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
      ) : paused ? (
        <PlayIcon data-icon="inline-start" />
      ) : (
        <PauseIcon data-icon="inline-start" />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}
