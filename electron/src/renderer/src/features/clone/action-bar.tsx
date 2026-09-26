import { PipelineFailure } from '@/components/pipeline-failure';
import { openTake } from '@/lib/store/takes';
import { setWorkspace } from '@/lib/store/workspace';
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import {
  AudioLinesIcon,
  ChevronDownIcon,
  ClockIcon,
  FocusIcon,
  GaugeIcon,
  LayersIcon,
  PlayIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  Settings2Icon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  ThermometerIcon,
  TimerIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/popover';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useGenerateClone } from '@/hooks/use-generate';
import {
  resetOverrides,
  setCloneSetting,
  useCloneSettings,
  type CloneSettings,
} from '@/lib/store/clone-settings';
import { cn } from '@/lib/utils';
import { EngineLanguagePicker } from './engine-language-picker';
import { CloneDemoAction } from './clone-demo';
import { useCloneDemo } from '@/hooks/use-clone-demo';

type NumericKey = 'steps' | 'cfg' | 'speed' | 'tShift' | 'posTemp' | 'classTemp' | 'layerPenalty';

interface SliderSpec {
  key: NumericKey;
  labelKey: string;
  icon: LucideIcon;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

const SLIDERS: SliderSpec[] = [
  {
    key: 'steps',
    labelKey: 'clone.steps',
    icon: SlidersHorizontalIcon,
    min: 8,
    max: 64,
    step: 1,
  },
  {
    key: 'cfg',
    labelKey: 'clone.cfg',
    icon: FocusIcon,
    min: 1,
    max: 4,
    step: 0.1,
  },
  {
    key: 'speed',
    labelKey: 'clone.speed',
    icon: GaugeIcon,
    min: 0.5,
    max: 2,
    step: 0.1,
    suffix: '×',
  },
  {
    key: 'tShift',
    labelKey: 'clone.tshift',
    icon: TimerIcon,
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'posTemp',
    labelKey: 'clone.pos_temp',
    icon: ThermometerIcon,
    min: 0,
    max: 10,
    step: 0.5,
  },
  {
    key: 'classTemp',
    labelKey: 'clone.class_temp',
    icon: ShuffleIcon,
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    key: 'layerPenalty',
    labelKey: 'clone.layer_pen',
    icon: LayersIcon,
    min: 0,
    max: 10,
    step: 0.5,
  },
];

function decimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

interface SliderRowProps {
  spec: SliderSpec;
  value: number;
}

function SliderRow({ spec, value }: SliderRowProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const Icon = spec.icon;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        {/* Base UI names the thumb's <input> from the root's aria-labelledby. */}
        <span
          id={labelId}
          className="inline-flex items-center gap-1.5 text-[length:var(--text-label)] font-medium"
        >
          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {t(spec.labelKey)}
        </span>
        <output className="text-[length:var(--text-label)] text-primary tabular-nums">
          {value.toFixed(decimals(spec.step))}
          {spec.suffix ?? ''}
        </output>
      </div>
      <Slider
        aria-labelledby={labelId}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={[value]}
        onValueChange={(next) => {
          const n = Array.isArray(next) ? next[0] : next;
          if (typeof n === 'number') setCloneSetting(spec.key, n);
        }}
      />
    </div>
  );
}

interface SwitchRowProps {
  settingKey: 'denoise' | 'postprocess';
  labelKey: string;
  icon: LucideIcon;
  checked: boolean;
}

function SwitchRow({ settingKey, labelKey, icon: Icon, checked }: SwitchRowProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      <Label htmlFor={id} className="gap-1.5 text-[length:var(--text-label)]">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {t(labelKey)}
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(next) => setCloneSetting(settingKey, next)}
      />
    </div>
  );
}

interface OverridesProps {
  settings: CloneSettings;
}

function Overrides({ settings }: OverridesProps) {
  const { t } = useTranslation();
  const durationId = useId();
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2">
        {SLIDERS.map((spec) => (
          <SliderRow key={spec.key} spec={spec} value={settings[spec.key]} />
        ))}
        <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-3">
          <Label htmlFor={durationId} className="gap-1.5 text-[length:var(--text-label)]">
            <ClockIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {t('clone.duration')}
          </Label>
          <Input
            id={durationId}
            inputMode="decimal"
            value={settings.duration}
            onChange={(event) => setCloneSetting('duration', event.target.value)}
            placeholder={t('clone.auto')}
            className="h-7 text-[length:var(--text-label)] tabular-nums"
          />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2">
        <SwitchRow
          settingKey="denoise"
          labelKey="clone.denoise"
          icon={AudioLinesIcon}
          checked={settings.denoise}
        />
        <SwitchRow
          settingKey="postprocess"
          labelKey="clone.postprocess"
          icon={SparklesIcon}
          checked={settings.postprocess}
        />
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="xs" onClick={() => resetOverrides()}>
          <RotateCcwIcon data-icon="inline-start" />
          {t('clone.reset_overrides')}
        </Button>
      </div>
    </div>
  );
}

export function ProductionSettings() {
  const settings = useCloneSettings();
  return <Overrides settings={settings} />;
}

export function ActionBar({
  onOpenSettings,
  settingsOpen = false,
}: { onOpenSettings?: () => void; settingsOpen?: boolean } = {}) {
  const { t } = useTranslation();
  const settings = useCloneSettings();
  const demo = useCloneDemo();
  const readinessId = useId();
  const {
    generate,
    cancel,
    isGenerating,
    elapsedSeconds,
    progress,
    stage,
    modelStage,
    modelProgress,
    error,
    clearError,
    cloneBlocker: blocker,
  } = useGenerateClone();
  const generationLabel = isGenerating
    ? t(
        stage === 'loading'
          ? modelStage
            ? `synthesisState.${modelStage}`
            : 'synthesisState.loading'
          : stage === 'receiving'
            ? 'synthesisState.receiving'
            : stage === 'preparing'
              ? 'synthesisState.preparing'
              : 'clone.generating_status',
      )
    : t('clone.synthesize');

  return (
    <section className="@container/composer">
      {blocker && !isGenerating && (
        <div
          id={readinessId}
          className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground"
        >
          <span role="status">
            {t(
              blocker === 'engine'
                ? demo
                  ? 'demo.prerendered_chip'
                  : 'engines.none_ready_title'
                : blocker === 'reference'
                  ? 'tts_errors.upload_or_select'
                  : blocker === 'text'
                    ? 'tts_errors.enter_text'
                    : 'preferences.loading',
            )}
          </span>
          {blocker === 'reference' && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  openTake(null);
                  setWorkspace({ panel: 'voice' });
                }}
              >
                {t('clone.reference_audio')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setWorkspace({ libraryOpen: true, libraryTab: 'voices' })}
              >
                {t('clone.saved_profiles')}
              </Button>
            </div>
          )}
          {blocker === 'engine' && !demo && (
            <Link
              to="/settings/models/$family"
              params={{ family: 'tts' }}
              className={buttonVariants({ variant: 'ghost', size: 'xs' })}
            >
              {t('engineSidebar.tts')}
            </Link>
          )}
        </div>
      )}
      {error && <PipelineFailure className="mb-3" fallback={error} onDismiss={clearError} />}
      <div className="flex flex-wrap items-center gap-3">
        {onOpenSettings ? (
          <div className="flex items-center gap-1 rounded-lg bg-background p-1 ring-1 ring-border/50">
            <EngineLanguagePicker />
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
            <Button
              variant={settingsOpen ? 'secondary' : 'ghost'}
              size="icon-lg"
              aria-label={t('clone.production_overrides')}
              aria-expanded={settingsOpen}
              onClick={onOpenSettings}
            >
              <Settings2Icon />
            </Button>
          </div>
        ) : (
          <Popover
            open={settings.showOverrides}
            onOpenChange={(open) => setCloneSetting('showOverrides', open)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">
                <EngineLanguagePicker />
              </div>
              <PopoverTrigger
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[length:var(--text-label)] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                  settings.showOverrides && 'bg-muted text-foreground',
                )}
              >
                <Settings2Icon className="size-3.5" aria-hidden="true" />
                {t('clone.production_overrides')}
                <ChevronDownIcon
                  className={cn(
                    'size-3.5 transition-transform',
                    settings.showOverrides && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </PopoverTrigger>
            </div>
            <PopoverContent
              side="top"
              align="end"
              className="max-h-[65vh] w-[min(560px,calc(100vw-48px))] overflow-y-auto p-4"
            >
              <Overrides settings={settings} />
            </PopoverContent>
          </Popover>
        )}

        <div className="ml-auto flex items-center gap-4">
          <div className="relative flex w-64 shrink-0 flex-col gap-1">
            <div className="flex gap-2">
              {demo ? (
                <CloneDemoAction />
              ) : (
                <Button
                  size="lg"
                  className="h-10 w-52 shrink-0 overflow-hidden rounded-lg px-4 shadow-sm transition-colors"
                  onClick={() => void generate()}
                  disabled={isGenerating || blocker !== null}
                  aria-describedby={blocker ? readinessId : undefined}
                  aria-busy={isGenerating}
                  aria-label={generationLabel}
                >
                  {isGenerating ? (
                    <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <PlayIcon data-icon="inline-start" />
                  )}
                  <span className="min-w-0 truncate" role={isGenerating ? 'status' : undefined}>
                    {generationLabel}
                  </span>
                </Button>
              )}
              {isGenerating && !demo ? (
                <Button
                  size="icon-lg"
                  className="size-10 shrink-0"
                  variant="outline"
                  onClick={() => cancel()}
                  aria-label={t('clone.cancel_generation')}
                >
                  <XIcon data-icon="inline-start" />
                </Button>
              ) : null}
            </div>
            <div className="h-5 w-52 text-right text-xs text-muted-foreground tabular-nums">
              {demo ? null : isGenerating ? (
                `${modelProgress != null && stage === 'loading' ? `${Math.round(modelProgress)}% · ` : ''}${elapsedSeconds.toFixed(1)}s`
              ) : (
                <Kbd className="bg-transparent shadow-none ring-0">{t('clone.shortcut_hint')}</Kbd>
              )}
            </div>
            {isGenerating ? (
              <ProgressPrimitive.Root
                value={stage === 'loading' ? modelProgress : progress}
                aria-label={t('clone.generating_status')}
                className="absolute inset-x-0 bottom-0"
              >
                <ProgressTrack>
                  <ProgressIndicator
                    className={cn(
                      (stage === 'loading' ? modelProgress : progress) == null &&
                        'w-full animate-pulse motion-reduce:animate-none',
                    )}
                  />
                </ProgressTrack>
              </ProgressPrimitive.Root>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
