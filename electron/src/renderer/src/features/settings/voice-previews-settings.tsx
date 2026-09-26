import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AudioLinesIcon, RefreshCwIcon } from 'lucide-react';
import { PipelineFailure } from '@/components/pipeline-failure';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { apiJson, describeError } from '@/lib/api/client';
import { SettingsRow, SettingsSection } from './settings-layout';

interface PreviewStatus {
  enabled: boolean;
  featured_cached: number;
  featured_total: number;
  checked_seconds_ago?: number | null;
  last_error?: string | null;
}

function formatChecked(seconds: number | null | undefined, language: string): string | null {
  if (seconds == null) return null;
  const formatter = new Intl.RelativeTimeFormat(language || 'en', { numeric: 'auto' });
  for (const [unit, size] of [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const) {
    if (seconds >= size) return formatter.format(-Math.floor(seconds / size), unit);
  }
  return formatter.format(0, 'minute');
}

export function VoicePreviewsSettings() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const query = useQuery({
    queryKey: ['voice-preview-cache'],
    queryFn: ({ signal }) => apiJson<PreviewStatus>('/archetypes/previews/status', { signal }),
  });
  const status = query.data;

  const send = async (path: string, method: 'PUT' | 'POST', body?: unknown) => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      client.setQueryData(
        ['voice-preview-cache'],
        await apiJson<PreviewStatus>(path, {
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const enabled = Boolean(status?.enabled);
  const cached = status?.featured_cached ?? 0;
  const total = status?.featured_total ?? 0;
  const checked = formatChecked(status?.checked_seconds_ago, i18n.language);
  const cacheLine = !enabled
    ? t('models.voice_previews_off')
    : total > 0 && cached >= total
      ? t('models.voice_previews_ready')
      : t('models.voice_previews_partial', { cached, total });
  const description = enabled
    ? `${cacheLine} · ${checked ? t('models.voice_previews_checked', { when: checked }) : t('models.voice_previews_never')}`
    : cacheLine;
  const failure =
    actionError || status?.last_error || (query.isError ? describeError(query.error) : '');

  return (
    <SettingsSection icon={AudioLinesIcon} title={t('models.voice_previews')}>
      <SettingsRow
        id="voice-previews"
        title={t('models.voice_previews')}
        titleHidden
        description={`${t('models.voice_previews_desc')} ${description}`}
      >
        {enabled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void send('/archetypes/previews/check', 'POST')}
          >
            <RefreshCwIcon className={busy ? 'animate-spin' : undefined} />
            {t('models.voice_previews_check')}
          </Button>
        )}
        <Switch
          checked={enabled}
          disabled={busy || query.isPending}
          aria-label={t('models.voice_previews')}
          onCheckedChange={(value) => void send('/archetypes/previews', 'PUT', { enabled: value })}
        />
      </SettingsRow>
      {failure && (
        <div className="p-4">
          <PipelineFailure
            fallback={t('models.voice_previews_rejected', { message: failure })}
            onDismiss={actionError ? () => setActionError('') : undefined}
            action={
              query.isError ? (
                <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
                  {t('common.retry')}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
    </SettingsSection>
  );
}
