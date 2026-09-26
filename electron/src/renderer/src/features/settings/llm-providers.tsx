import {
  BrainIcon,
  CheckCircle2Icon,
  CheckIcon,
  ListFilterIcon,
  PlugZapIcon,
  SaveIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiJson } from '@/lib/api/client';
import { queryKeys } from '@/lib/query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExternalLink } from '@/components/external-link';
import { SettingsRowsSkeleton, SettingsSection, SettingsRow } from './settings-layout';
const endpoint = '/api/settings/llm-providers';
export interface Provider {
  configured: boolean;
  id: string;
  display_name: string;
  local: boolean;
  needs_account: boolean;
  base_url: string;
  model: string;
  account_id?: string;
  signup_url?: string | null;
  notes?: string | null;
  has_key: boolean;
  key_from_env: boolean;
  base_url_from_env: boolean;
  model_from_env: boolean;
  account_from_env?: boolean;
  active_from_env: boolean;
}
interface Result {
  ok: boolean;
  kind?: string;
  model?: string;
  latency_ms?: number;
  models?: string[];
  truncated?: boolean;
}
export function useLlmProviderCatalogue() {
  return useQuery({
    queryKey: ['llm-providers'],
    queryFn: ({ signal }) =>
      apiJson<{ active: string; providers: Provider[] }>(endpoint, { signal }),
  });
}
export function LlmProviders() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('');
  const query = useLlmProviderCatalogue();
  const current =
    query.data?.providers.find((provider) => provider.id === (selected || query.data.active)) ||
    query.data?.providers.find((provider) => provider.local) ||
    query.data?.providers[0];
  const providerItems =
    query.data?.providers.map((provider) => ({
      value: provider.id,
      label: provider.display_name,
    })) ?? [];
  return (
    <SettingsSection icon={BrainIcon} title={t('settings.llm_providers')}>
      <p className="px-4 py-3 text-sm leading-5 text-muted-foreground">{t('settings.llmp_desc')}</p>
      <div>
        {query.isError && (
          <div className="p-4">
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('backend.retry')}
            </Button>
          </div>
        )}
        {query.isPending && <SettingsRowsSkeleton label={t('common.loading')} rows={3} />}
        {current && (
          <SettingsRow
            id="llm-provider"
            title={t('settings.llmp_provider')}
            description={t('settings.llmp_provider_hint')}
          >
            <Select
              items={providerItems}
              value={current.id}
              onValueChange={(value) => typeof value === 'string' && setSelected(value)}
            >
              <SelectTrigger className="w-full @2xl:w-80" aria-label={t('settings.llmp_provider')}>
                <SelectValue>
                  <span className="truncate">{current.display_name}</span>
                  {current.local && (
                    <span className="text-xs text-muted-foreground">
                      · {t('settings.llmp_local_tag')}
                    </span>
                  )}
                  {query.data?.active === current.id && (
                    <span className="text-xs text-primary">
                      · {t('settings.llmp_active_badge')}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {query.data?.providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <span>{provider.display_name}</span>
                    {provider.local && (
                      <span className="text-xs text-muted-foreground">
                        {t('settings.llmp_local_tag')}
                      </span>
                    )}
                    {query.data.active === provider.id && (
                      <span className="text-xs text-primary">
                        {t('settings.llmp_active_badge')}
                      </span>
                    )}
                    {provider.configured && query.data.active !== provider.id && (
                      <CheckIcon className="ml-auto text-success" aria-hidden="true" />
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        )}
        {current && (current.notes || current.signup_url) && (
          <SettingsRow
            id="llm-provider-about"
            title={t('settings.llmp_about')}
            description={current.notes || undefined}
          >
            {current.signup_url && (
              <ExternalLink href={current.signup_url}>
                {t(current.local ? 'common.learn_more' : 'settings.llmp_get_key')}
              </ExternalLink>
            )}
          </SettingsRow>
        )}
        {current && (
          <ProviderForm
            key={current.id}
            provider={current}
            active={query.data?.active === current.id}
          />
        )}
      </div>
    </SettingsSection>
  );
}
function ProviderForm({ provider, active }: { provider: Provider; active: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [fields, setFields] = useState({
    base_url: provider.base_url,
    model: provider.model,
    account_id: provider.account_id || '',
    api_key: '',
  });
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => () => operation.current?.abort(), []);
  const change = (key: keyof typeof fields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setResult(null);
    setSaved(false);
  };
  const run = async (action: 'save' | 'activate' | 'test' | 'models') => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFailed(null);
    setResult(null);
    setSaved(false);
    let persisted = false;
    if (action === 'models') setModels([]);
    try {
      // Never probe stale saved values after a failed save. Blank key preserves it.
      const body = {
        ...(!provider.base_url_from_env ? { base_url: fields.base_url.trim() } : {}),
        ...(!provider.model_from_env ? { model: fields.model.trim() } : {}),
        ...(provider.needs_account && !provider.account_from_env
          ? { account_id: fields.account_id.trim() }
          : {}),
        ...(fields.api_key && !provider.key_from_env ? { api_key: fields.api_key } : {}),
        make_active: action === 'activate' && !provider.active_from_env,
      };
      await apiJson(endpoint + '/' + encodeURIComponent(provider.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      persisted = true;
      if (action === 'activate' && !provider.active_from_env) {
        await apiJson('/engines/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ family: 'llm', backend_id: 'openai-compat' }),
          signal: controller.signal,
        });
      }
      if (controller.signal.aborted) return;
      setFields((current) => ({ ...current, api_key: '' }));
      setSaved(true);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['llm-providers'] }),
        client.invalidateQueries({ queryKey: ['llm-skills'] }),
        client.invalidateQueries({ queryKey: ['translation-engines'] }),
        client.invalidateQueries({ queryKey: queryKeys.engines }),
        client.invalidateQueries({ queryKey: ['sidebar-model-status'] }),
      ]);
      if (action === 'test' || action === 'models') {
        const response = await apiJson<Result>(
          endpoint + '/' + encodeURIComponent(provider.id) + '/' + action,
          { method: action === 'test' ? 'POST' : 'GET', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (action === 'models' && response.ok) setModels(response.models || []);
        else setResult(response);
      }
    } catch {
      if (!controller.signal.aborted)
        setFailed(persisted ? 'settings.llmp_err_error' : 'settings.llmp_save_failed');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      operation.current = null;
    }
  };
  const field = (key: keyof typeof fields, title: string, pinned: boolean, password = false) => (
    <SettingsRow
      id={'llm-' + key}
      title={t('settings.' + title)}
      description={pinned ? t('settings.llmp_env_override') : undefined}
    >
      <Input
        aria-label={t('settings.' + title)}
        type={password ? 'password' : 'text'}
        autoComplete="off"
        value={fields[key]}
        disabled={busy || pinned}
        placeholder={
          password
            ? t(provider.has_key ? 'settings.llmp_key_stored' : 'settings.llmp_key_paste')
            : undefined
        }
        onChange={(event) => change(key, event.target.value)}
      />
    </SettingsRow>
  );
  const kind =
    result?.kind && ['config', 'auth', 'not_found', 'rate_limit', 'network'].includes(result.kind)
      ? result.kind
      : 'error';
  return (
    <div className="divide-y divide-border/50">
      {provider.needs_account &&
        field('account_id', 'llmp_account_id', Boolean(provider.account_from_env))}
      {!provider.local && field('api_key', 'llmp_api_key', provider.key_from_env, true)}
      {field('base_url', 'llmp_base_url', provider.base_url_from_env)}
      {field('model', 'llmp_model', provider.model_from_env)}
      {models.length > 0 && (
        <div className="max-h-48 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {models.map((model) => (
              <Button
                key={model}
                size="xs"
                variant="ghost"
                disabled={busy || provider.model_from_env}
                onClick={() => change('model', model)}
              >
                {model}
              </Button>
            ))}
          </div>
        </div>
      )}
      {provider.active_from_env && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {t('settings.llmp_active_env_pin')}
        </p>
      )}
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button
          size="sm"
          disabled={busy || provider.active_from_env}
          onClick={() => void run('activate')}
        >
          <CheckCircle2Icon />
          {t(active ? 'settings.llmp_save_keep' : 'settings.llmp_save_active')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run('test')}>
          <PlugZapIcon />
          {t('settings.llmp_test')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('models')}>
          <ListFilterIcon />
          {t('settings.llmp_fetch_models')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('save')}>
          <SaveIcon />
          {t('settings.llmp_save')}
        </Button>
      </div>
      {busy && (
        <p role="status" className="px-4 py-3 text-xs">
          {t('common.loading')}
        </p>
      )}
      {saved && !active && !provider.active_from_env && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {t('settings.llmp_saved_not_active')}
        </p>
      )}
      {failed && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {t(failed)}
        </p>
      )}
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className="px-4 py-3 text-sm">
          {result.ok
            ? t('settings.llmp_test_ok', { model: result.model, ms: result.latency_ms })
            : t('settings.llmp_err_' + kind)}
        </p>
      )}
    </div>
  );
}
