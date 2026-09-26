import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  LanguagesIcon,
  MicIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export type CheckpointStage = 'asr' | 'translate' | 'done';

const stages = {
  asr: {
    title: 'checkpoint.asr_title',
    hint: 'checkpoint.asr_hint',
    cta: 'checkpoint.asr_cta',
    Icon: MicIcon,
    ActionIcon: LanguagesIcon,
  },
  translate: {
    title: 'checkpoint.translate_title',
    hint: 'checkpoint.translate_hint',
    cta: 'checkpoint.translate_cta',
    Icon: LanguagesIcon,
    ActionIcon: SparklesIcon,
  },
  done: {
    title: 'checkpoint.done_title',
    hint: 'checkpoint.done_hint',
    cta: null,
    Icon: CheckCircle2Icon,
    ActionIcon: null,
  },
} as const;

export function CheckpointBanner({
  stage,
  timingWarnings,
  disabled,
  onContinue,
  onDismiss,
}: {
  stage: CheckpointStage;
  timingWarnings: number;
  disabled?: boolean;
  onContinue?: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const config = stages[stage];
  const Icon = config.Icon;
  const ActionIcon = config.ActionIcon;

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-primary/15 bg-muted/60 px-3 py-2"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t(config.title)}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t(config.hint)}</p>
        {stage === 'done' && timingWarnings > 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangleIcon className="size-3.5" />
            {t('checkpoint.timing_review', { count: timingWarnings })}
          </p>
        )}
      </div>
      {config.cta && onContinue && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={onContinue}>
          {ActionIcon && <ActionIcon />}
          {t(config.cta)}
          <ArrowRightIcon />
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('checkpoint.dismiss_title')}
        title={t('checkpoint.dismiss_title')}
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </div>
  );
}
