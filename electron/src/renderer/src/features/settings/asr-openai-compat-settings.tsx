import { CheckCircle2Icon, LoaderCircleIcon, MicIcon, PlugIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiJson, describeError } from '@/lib/api/client';
import { queryKeys } from '@/lib/query';
import { SettingsActionError } from './settings-action-error';
import { SettingsRow, SettingsSection } from './settings-layout';

interface AsrCompatConfig {
  base_url: string;
  model: string;
  has_key: boolean;
}

interface AsrCompatTestResult {
  ok: boolean;
  status: string;
  latency_ms?: number;
  http_status?: number;
  model_found?: boolean;
  detail?: string;
}

const EMPTY_CONFIG: AsrCompatConfig = { base_url: '', model: '', has_key: false };

export function AsrOpenAiCompatSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ['asr-openai-compat'],
    queryFn: ({ signal }) =>
      apiJson<AsrCompatConfig>('/api/settings/asr-openai-compat', { signal }),
  });
  const [server, setServer] = useState(EMPTY_CONFIG);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<AsrCompatTestResult | null>(null);

  useEffect(() => {
    if (!config.data) return;
    setServer(config.data);
    setBaseUrl(config.data.base_url || '');
    setModel(config.data.model || '');
    setApiKey('');
  }, [config.data]);

  const edit = (setter: (value: string) => void, value: string) => {
    setter(value);
    setSaved(false);
    setTestResult(null);
  };

  const dirty = baseUrl !== server.base_url || model !== server.model || apiKey !== '';

  const save = async () => {
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      const next = await apiJson<AsrCompatConfig>('/api/settings/asr-openai-compat', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: baseUrl,
          model,
          ...(apiKey ? { api_key: apiKey } : {}),
        }),
      });
      setServer(next);
      setBaseUrl(next.base_url || '');
      setModel(next.model || '');
      setApiKey('');
      setSaved(true);
      queryClient.setQueryData(['asr-openai-compat'], next);
      await queryClient.invalidateQueries({ queryKey: queryKeys.engines });
      return true;
    } catch (reason) {
      setError(describeError(reason));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (testing || saving) return;
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      if (dirty && !(await save())) return;
      setTestResult(
        await apiJson<AsrCompatTestResult>('/api/settings/asr-openai-compat/test', {
          method: 'POST',
        }),
      );
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setTesting(false);
    }
  };

  const testMessage = (result: AsrCompatTestResult) => {
    const ms = Math.round(result.latency_ms || 0);
    if (result.ok && result.model_found === false)
      return t('settings.asr_compat_model_missing', { model: server.model, ms });
    if (result.ok) return t('settings.llmp_test_ok', { model: server.model, ms });
    if (result.status === 'auth_failed') return t('settings.llmp_err_auth');
    if (result.status === 'not_configured') return t('settings.llmp_err_config');
    if (result.status === 'unreachable' || result.status === 'timeout')
      return t('settings.llmp_err_network');
    if (result.http_status === 404) return t('settings.llmp_err_not_found');
    return result.detail || t('settings.llmp_err_error');
  };

  return (
    <SettingsSection icon={MicIcon} title={t('settings.asr_compat_title')}>
      <SettingsRow
        id="asr-openai-compat-overview"
        title={t('settings.asr_compat_desc')}
        description={t('settings.asr_compat_url_hint')}
      >
        {config.isPending && (
          <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
        )}
      </SettingsRow>

      {(config.isError || error) && (
        <div className="p-4">
          <SettingsActionError
            title={t('modelSettings.failed')}
            detail={error || describeError(config.error)}
            onDismiss={error ? () => setError('') : undefined}
          />
        </div>
      )}

      <SettingsRow id="asr-openai-compat-url" title={t('settings.llmp_base_url')}>
        <Input
          aria-label={t('settings.llmp_base_url')}
          value={baseUrl}
          className="w-full font-mono @2xl:w-96"
          placeholder="http://localhost:8000/v1"
          disabled={config.isPending || saving || testing}
          onChange={(event) => edit(setBaseUrl, event.target.value)}
        />
      </SettingsRow>

      <SettingsRow id="asr-openai-compat-model" title={t('settings.llmp_model')}>
        <Input
          aria-label={t('settings.llmp_model')}
          value={model}
          className="w-full font-mono @2xl:w-96"
          placeholder="whisper-1"
          disabled={config.isPending || saving || testing}
          onChange={(event) => edit(setModel, event.target.value)}
        />
      </SettingsRow>

      <SettingsRow
        id="asr-openai-compat-key"
        title={t('settings.llmp_api_key')}
        description={server.has_key ? t('settings.llmp_key_stored') : t('settings.llmp_key_paste')}
      >
        <Input
          aria-label={t('settings.llmp_api_key')}
          type="password"
          value={apiKey}
          className="w-full font-mono @2xl:w-72"
          placeholder={server.has_key ? '••••••••' : t('settings.llmp_key_paste')}
          autoComplete="off"
          disabled={config.isPending || saving || testing}
          onChange={(event) => edit(setApiKey, event.target.value)}
        />
        <Button disabled={!dirty || saving || testing} onClick={() => void save()}>
          {saving && <LoaderCircleIcon className="animate-spin" />}
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        {saved && !dirty && (
          <span role="status" className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2Icon className="size-3.5" />
            {t('settings.asr_compat_saved')}
          </span>
        )}
      </SettingsRow>

      <SettingsRow
        id="asr-openai-compat-test"
        title={t('settings.llmp_test')}
        description={t('settings.asr_compat_test_hint')}
      >
        <Button
          variant="outline"
          disabled={testing || saving || !baseUrl.trim()}
          onClick={() => void testConnection()}
        >
          {testing ? <LoaderCircleIcon className="animate-spin" /> : <PlugIcon />}
          {testing ? t('common.loading') : t('settings.llmp_test')}
        </Button>
        {testResult && (
          <span
            role="status"
            title={testResult.detail}
            className={testResult.ok ? 'text-xs text-success' : 'text-xs text-destructive'}
          >
            {testMessage(testResult)}
          </span>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
