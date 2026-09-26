import { CheckIcon, GaugeIcon, GlobeIcon, ServerIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiJson } from '@/lib/api/client';
import { SettingsSection, SettingsRow } from './settings-layout';
import { useSettingsAction } from './use-settings-action';
interface MirrorState {
  configured: string;
  effective: string;
  presets: { label: string; url: string }[];
  mode: string;
  restart_required?: boolean;
  auto?: { endpoint: string; reachable: boolean; latency_ms?: number; checked_at?: number };
}
export function MirrorSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['hf-mirror'];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiJson<MirrorState>('/api/settings/hf-mirror', { signal }),
  });
  const [url, setUrl] = useState('');
  const dirty = useRef(false);
  const action = useSettingsAction();
  useEffect(() => {
    if (!dirty.current && query.data) setUrl(query.data.configured || '');
  }, [query.data]);
  const save = (url: string, mode = 'manual') =>
    action.run(async () => {
      const next = await apiJson<MirrorState>('/api/settings/hf-mirror', {
        method: 'PUT',
        body: JSON.stringify({ url: url.trim(), mode }),
      });
      dirty.current = false;
      setUrl(next.configured || '');
      client.setQueryData(key, next);
    });
  const test = () =>
    action.run(async () => {
      const next = await apiJson<MirrorState>('/api/settings/hf-mirror/test', { method: 'POST' });
      client.setQueryData(key, next);
    }, false);
  const state = query.data;
  return (
    <SettingsSection icon={GlobeIcon} title={t('models.mirror_title')}>
      <p className="px-4 pb-3 text-xs text-muted-foreground">{t('models.mirror_description')}</p>
      {state && (
        <>
          <div className="space-y-1 p-2" role="radiogroup" aria-label={t('models.mirror_title')}>
            <Button
              role="radio"
              aria-checked={state.mode === 'auto'}
              variant="ghost"
              disabled={action.busy}
              className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left aria-checked:bg-accent/70 aria-checked:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_22%,transparent)]"
              onClick={() => void save('', 'auto')}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background">
                <GaugeIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t('clone.auto')}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {!state.auto
                    ? t('models.mirror_auto_untested')
                    : !state.auto.reachable
                      ? t('models.mirror_auto_offline')
                      : state.auto.endpoint}
                </span>
              </span>
              {state.mode === 'auto' && (
                <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              )}
            </Button>
            {state.presets.map((preset) => {
              const selected =
                state.mode !== 'auto' &&
                state.configured.replace(/\/$/, '') === preset.url.replace(/\/$/, '');
              return (
                <Button
                  key={preset.url || preset.label}
                  role="radio"
                  aria-checked={selected}
                  variant="ghost"
                  disabled={action.busy}
                  className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left aria-checked:bg-accent/70 aria-checked:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_22%,transparent)]"
                  onClick={() => void save(preset.url)}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background">
                    <ServerIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{preset.label}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {preset.url ? new URL(preset.url).hostname : preset.label}
                    </span>
                  </span>
                  {selected && (
                    <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  )}
                </Button>
              );
            })}
          </div>
          {state.mode === 'auto' && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground">
              <span>
                {state.auto?.reachable && typeof state.auto.latency_ms === 'number'
                  ? `${Math.round(state.auto.latency_ms)} ms`
                  : t(!state.auto ? 'models.mirror_auto_untested' : 'models.mirror_auto_offline')}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={action.busy}
                onClick={() => void test()}
              >
                {t('models.mirror_auto_test')}
              </Button>
            </div>
          )}
          <SettingsRow id="mirror-custom" title={t('models.mirror_custom_url')}>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save(url);
              }}
            >
              <Input
                type="url"
                aria-label={t('models.mirror_custom_url')}
                value={url}
                disabled={action.busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  dirty.current = true;
                  setUrl(event.target.value);
                  action.reset();
                }}
              />
              <Button size="sm" type="submit" disabled={action.busy}>
                {t('common.save')}
              </Button>
            </form>
          </SettingsRow>
          {state.restart_required && (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              {t('models.mirror_restart_note')}
            </p>
          )}
        </>
      )}
      {query.isPending && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {t('preferences.loading')}
        </p>
      )}
      {action.saved && (
        <p role="status" className="p-4 text-xs text-muted-foreground">
          {t('models.mirror_saved')}
        </p>
      )}
      {(query.isError || action.error) && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {t('common.error')}{' '}
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </p>
      )}
    </SettingsSection>
  );
}
