import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3Icon, ShieldCheckIcon } from 'lucide-react';
import { PipelineFailure } from '@/components/pipeline-failure';
import { getBridge } from '@/components/bridge';
import { Button } from '@/components/ui/button';
import { useBackendStatus } from '@/hooks/use-backend-status';
import { apiJson, describeError } from '@/lib/api/client';
import { SettingsRow, SettingsSection } from './settings-layout';

interface UsageRow {
  name: string;
  count: number;
}

interface UsageSummary {
  takes: number;
  audio_seconds: number;
  voices: number;
  active_days: number;
  dubs: number;
  starred: number;
  first_at?: number | null;
  by_mode: UsageRow[];
  by_language: UsageRow[];
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
      <p className="font-mono text-lg font-medium tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: UsageRow[] }) {
  if (!rows.length) return null;
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-medium text-foreground/80">{title}</h3>
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid grid-cols-[minmax(5rem,8rem)_1fr_2.5rem] items-center gap-3"
        >
          <span className="truncate text-sm">{row.name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.round((row.count / maximum) * 100)}%` }}
            />
          </span>
          <span className="text-right font-mono text-sm tabular-nums text-muted-foreground">
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export function UsageSettings() {
  const { t } = useTranslation();
  const backend = useBackendStatus();
  const bridge = getBridge();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const query = useQuery({
    queryKey: ['usage-summary'],
    queryFn: ({ signal }) => apiJson<UsageSummary>('/stats/usage', { signal }),
    enabled: !backend.remote,
  });
  const summary = query.data;
  const since = summary?.first_at
    ? new Date(summary.first_at * 1000).toLocaleDateString()
    : undefined;

  return (
    <SettingsSection icon={BarChart3Icon} title={t('settings.usage')}>
      <SettingsRow
        id="usage-overview"
        title={t('settings.usage')}
        description={t('settings.usage_desc')}
      >
        <ShieldCheckIcon aria-hidden="true" className="size-4 text-success" />
      </SettingsRow>
      {backend.remote ? (
        <SettingsRow
          id="usage-local-backend"
          title={t('settings.remote_backend_title')}
          description={t('settings.remote_backend_desc')}
        >
          <Button
            size="sm"
            disabled={!bridge || switching}
            onClick={async () => {
              if (!bridge) return;
              setSwitching(true);
              setSwitchError('');
              try {
                await bridge.backend.useLocal();
                window.location.reload();
              } catch (error) {
                setSwitchError(describeError(error));
              } finally {
                setSwitching(false);
              }
            }}
          >
            {t('settings.remote_backend_use_local')}
          </Button>
        </SettingsRow>
      ) : (
        <>
          <p className="flex items-start gap-2 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{t('settings.usage_privacy')}</span>
          </p>
          {query.isError && (
            <div className="p-4">
              <PipelineFailure
                fallback={describeError(query.error)}
                action={
                  <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
                    {t('common.retry')}
                  </Button>
                }
              />
            </div>
          )}
          {query.isPending && (
            <p role="status" className="px-4 py-5 text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          )}
          {summary?.takes === 0 && (
            <p className="px-4 py-5 text-sm text-muted-foreground">{t('settings.usage_empty')}</p>
          )}
          {summary && summary.takes > 0 && (
            <div className="space-y-6 p-4">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
                <Stat
                  label={t('settings.usage_takes')}
                  value={summary.takes}
                  sub={since ? t('settings.usage_since', { date: since }) : undefined}
                />
                <Stat
                  label={t('settings.usage_audio')}
                  value={formatDuration(summary.audio_seconds)}
                />
                <Stat label={t('settings.usage_voices')} value={summary.voices} />
                <Stat label={t('settings.usage_active_days')} value={summary.active_days} />
                {summary.dubs > 0 && <Stat label={t('settings.usage_dubs')} value={summary.dubs} />}
                {summary.starred > 0 && (
                  <Stat label={t('settings.usage_starred')} value={summary.starred} />
                )}
              </div>
              <Bars title={t('settings.usage_by_mode')} rows={summary.by_mode ?? []} />
              <Bars title={t('settings.usage_by_language')} rows={summary.by_language ?? []} />
            </div>
          )}
        </>
      )}
      {backend.remote && switchError && (
        <div className="p-4">
          <PipelineFailure fallback={switchError} onDismiss={() => setSwitchError('')} />
        </div>
      )}
    </SettingsSection>
  );
}
