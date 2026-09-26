import { BookOpenIcon, CpuIcon } from 'lucide-react';
import { ShortcutSettings } from './shortcut-settings';
import { RefinementSettings } from './refinement-settings';
import { LlmSkills } from './llm-skills';
import { LlmProviders } from './llm-providers';
import { Switch } from '@/components/ui/switch';
import { TranslationSettings } from './translation-settings';
import { EngineInstall } from './engine-install';
import { EngineLicense, licensedEngine } from './engine-license';
import { EngineHealth } from './engine-health';
import { ModelLibrary, PerformanceModelPacks } from './model-library';
import { useModelCatalogue } from './model-catalogue-query';
import { familyIcons, modelFamilies, type ModelFamily } from './model-family';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckIcon, ChevronRightIcon, DownloadIcon } from 'lucide-react';
import { engineFamilyState, useEngines } from '@/hooks/use-engines';
import { apiJson, describeError } from '@/lib/api/client';
import { queryKeys } from '@/lib/query';
import { Button, buttonVariants } from '@/components/ui/button';
import { SettingsRowsSkeleton, SettingsSection, SettingsRow } from './settings-layout';
import { SettingsActionError } from './settings-action-error';
import { VoicePreviewsSettings } from './voice-previews-settings';
import { AsrOpenAiCompatSettings } from './asr-openai-compat-settings';
import { AecSettings } from './aec-settings';
import { ExternalLink } from '@/components/external-link';
import { ComputeVendorIcon, formatComputeRuntime } from '@/components/compute-vendor-icon';
import {
  engineSelectionFeedback,
  type EngineSelectionResult,
} from '@/lib/engine-selection-feedback';

interface DiarisationStatus {
  active: string;
  options: {
    id: string;
    label: string;
    model?: string | null;
    model_installed?: boolean;
    runtime_installed?: boolean;
    installed: boolean;
    reason?: string | null;
  }[];
}

export function DiarisationSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['diarisation-status'],
    queryFn: () => apiJson<DiarisationStatus>('/engines/diarisation'),
  });
  const runtime = useQuery({
    queryKey: ['audiocpp-runtime-install'],
    queryFn: () =>
      apiJson<{
        installed: boolean;
        supported: boolean;
        install_allowed?: boolean;
        job: { state: string; progress: number; error?: string | null };
      }>('/engines/audiocpp/runtime/install/status'),
    refetchInterval: (state) => (state.state.data?.job.state === 'running' ? 1_500 : 10_000),
  });
  useEffect(() => {
    if (!runtime.data?.installed) return;
    void Promise.all([
      client.invalidateQueries({ queryKey: ['diarisation-status'] }),
      client.invalidateQueries({ queryKey: ['sidebar-diarisation'] }),
      client.invalidateQueries({ queryKey: queryKeys.engines }),
    ]);
  }, [client, runtime.data?.installed]);
  const runtimeRunning = busy || runtime.data?.job.state === 'running';
  const installRuntime = async () => {
    if (runtime.data?.install_allowed === false) return;
    setBusy(true);
    setFailed(null);
    try {
      await apiJson('/engines/audiocpp/runtime/install', { method: 'POST' });
      await runtime.refetch();
    } catch (error) {
      setFailed(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  const select = async (engineId: string) => {
    setBusy(true);
    setFailed(null);
    try {
      const result = await apiJson<EngineSelectionResult>('/engines/diarisation/select', {
        method: 'POST',
        body: JSON.stringify({ engine_id: engineId }),
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['diarisation-status'] }),
        client.invalidateQueries({ queryKey: ['sidebar-diarisation'] }),
        client.invalidateQueries({ queryKey: ['loaded-models'] }),
      ]);
      const feedback = engineSelectionFeedback(result, 'diarisation');
      toast.success(t(feedback.key, feedback.values));
    } catch (error) {
      setFailed(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection icon={familyIcons.diarisation} title={t('engineSidebar.diarisation')}>
      {query.isPending ? (
        <SettingsRowsSkeleton label={t('preferences.loading')} />
      ) : query.isError ? (
        <SettingsActionError
          className="m-4"
          title={t('modelSettings.failed')}
          detail={describeError(query.error)}
          action={
            <Button size="xs" variant="ghost" onClick={() => void query.refetch()}>
              {t('backend.retry')}
            </Button>
          }
        />
      ) : (
        query.data.options.map((option) => (
          <SettingsRow
            key={option.id}
            id={'diarisation-engine-' + option.id}
            title={option.label}
            description={
              option.model || option.reason ? (
                <div className="space-y-1">
                  {option.model && <p>{option.model}</p>}
                  {option.reason && <p>{option.reason}</p>}
                </div>
              ) : undefined
            }
            active={query.data.active === option.id}
          >
            <span className="text-xs text-muted-foreground">
              {option.installed
                ? t('modelSettings.available')
                : option.model_installed
                  ? `${t('modelMaintenance.installed')} · ${t('modelSettings.unavailable')}`
                  : t('modelSettings.unavailable')}
            </span>
            {option.id === 'audiocpp-sortformer' &&
              option.model_installed &&
              !option.runtime_installed &&
              runtime.data?.supported === true && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runtimeRunning || runtime.data?.install_allowed === false}
                  title={
                    runtime.data?.install_allowed === false
                      ? t('engines.localInstallRequired')
                      : undefined
                  }
                  onClick={() => void installRuntime()}
                >
                  <DownloadIcon />
                  {runtimeRunning
                    ? `${t('modelMaintenance.installing')} ${Math.round(
                        (runtime.data?.job.progress || 0) * 100,
                      )}%`
                    : t('modelMaintenance.install')}
                </Button>
              )}
            {option.id === 'audiocpp-sortformer' &&
              !option.runtime_installed &&
              runtime.data?.install_allowed === false && (
                <p className="max-w-sm text-xs text-muted-foreground">
                  {t('engines.localInstallRequired')}
                </p>
              )}
            {option.installed && (
              <Button
                size="sm"
                variant={query.data.active === option.id ? 'secondary' : 'outline'}
                disabled={busy || query.data.active === option.id}
                aria-pressed={query.data.active === option.id}
                onClick={() => void select(option.id)}
              >
                {query.data.active === option.id && <CheckIcon />}
                {t(
                  query.data.active === option.id
                    ? 'modelSettings.selected'
                    : 'modelSettings.select',
                )}
              </Button>
            )}
          </SettingsRow>
        ))
      )}
      {runtime.isError && (
        <SettingsActionError
          className="m-4"
          title={t('modelMaintenance.failed')}
          detail={describeError(runtime.error)}
          action={
            <Button size="xs" variant="ghost" onClick={() => void runtime.refetch()}>
              {t('backend.retry')}
            </Button>
          }
        />
      )}
      {failed && (
        <SettingsActionError
          className="m-4"
          title={t('modelSettings.failed')}
          detail={failed}
          onDismiss={() => setFailed(null)}
        />
      )}
      {runtime.data?.job.state === 'error' && runtime.data.job.error && (
        <SettingsActionError
          className="m-4"
          title={t('modelMaintenance.failed')}
          detail={runtime.data.job.error}
        />
      )}
    </SettingsSection>
  );
}

export function ModelSettings({
  family,
  showLibrary = true,
}: {
  family?: ModelFamily;
  showLibrary?: boolean;
}) {
  const { t } = useTranslation();
  const engines = useEngines();
  const catalogue = useModelCatalogue();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const dictation = useQuery({
    queryKey: ['settings-dictation'],
    enabled: family === 'dictation',
    queryFn: async () => {
      const [prefs, catalogue] = await Promise.all([
        apiJson<{ model_id: string; enabled: boolean }>('/dictation/prefs'),
        apiJson<{
          engine_available: boolean;
          models: {
            id: string;
            label: string;
            installed: boolean;
            repo_id: string;
          }[];
        }>('/dictation/models'),
      ]);
      return { ...prefs, ...catalogue };
    },
  });
  const select = async (id: string, modelId?: string) => {
    setBusy(true);
    setFailed(null);
    try {
      const result = await apiJson<EngineSelectionResult>(
        family === 'dictation' ? '/dictation/prefs' : '/engines/select',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            family === 'dictation'
              ? { model_id: id, enabled: true }
              : {
                  family,
                  backend_id: id,
                  ...(modelId ? { model_id: modelId } : {}),
                },
          ),
        },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.engines }),
        client.invalidateQueries({ queryKey: ['loaded-models'] }),
        client.invalidateQueries({ queryKey: ['sidebar-model-status'] }),
        client.invalidateQueries({ queryKey: ['settings-dictation'] }),
        client.invalidateQueries({ queryKey: ['sidebar-dictation'] }),
        client.invalidateQueries({ queryKey: ['dictation-shortcut-prefs'] }),
        client.invalidateQueries({ queryKey: ['performance-profile'] }),
      ]);
      const feedback = engineSelectionFeedback(
        family === 'dictation' ? { active: id } : result,
        family ?? 'tts',
      );
      if (feedback.tone === 'warning') toast.warning(t(feedback.key, feedback.values));
      else toast.success(t(feedback.key, feedback.values));
    } catch (error) {
      setFailed(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  const setDictationEnabled = async (enabled: boolean) => {
    setBusy(true);
    setFailed(null);
    try {
      await apiJson('/dictation/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await Promise.all(
        [
          'settings-dictation',
          'sidebar-dictation',
          'transcription-readiness',
          'dictation-shortcut-prefs',
          'performance-profile',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    } catch (error) {
      setFailed(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  if (!family)
    return (
      <>
        <PerformanceModelPacks />
        <VoicePreviewsSettings />
        <SettingsSection icon={CpuIcon} title={t('modelSettings.models')} contentVariant="cards">
          {modelFamilies.map((item) =>
            (() => {
              const Icon = familyIcons[item];
              return (
                <Link
                  key={item}
                  to="/settings/models/$family"
                  params={{ family: item }}
                  className={buttonVariants({
                    variant: 'ghost',
                    className:
                      'glass-panel min-h-20 min-w-0 justify-between rounded-xl border border-border/60 bg-card px-4 py-4 shadow-xs/5 transition-[border-color,background-color,box-shadow] hover:border-border hover:bg-primary/[0.04]',
                  })}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="size-4 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" />
                    {t('engineSidebar.' + item)}
                  </span>
                  <ChevronRightIcon className="text-muted-foreground transition-colors duration-150 group-hover:text-foreground" />
                </Link>
              );
            })(),
          )}
        </SettingsSection>
      </>
    );
  if (family === 'translation')
    return (
      <>
        <TranslationSettings />
        <ModelLibrary family={family} />
      </>
    );
  if (family === 'diarisation')
    return (
      <>
        <DiarisationSettings />
        <ModelLibrary family={family} />
      </>
    );
  const engineState = family === 'dictation' ? undefined : engineFamilyState(engines.data, family);
  const selected = family === 'dictation' ? dictation.data?.model_id : engineState?.active;
  const selectedModel = family === 'dictation' ? undefined : engineState?.active_model;
  const rows =
    family === 'dictation'
      ? dictation.data?.models.map((model) => ({
          id: model.id,
          name: model.label,
          available: model.installed && dictation.data!.engine_available,
          detail: model.repo_id,
          models: undefined,
          installable: false,
          setupSnippet: undefined,
          docsUrl: undefined,
          device: undefined,
          routingStatus: undefined,
          routingReason: undefined,
          isolationMode: undefined,
        }))
      : engineState?.backends.map((engine) => ({
          id: engine.id,
          name: engine.display_name,
          available: engine.available,
          detail:
            engine.local_install_required && !engine.available
              ? t('engines.localInstallRequired')
              : engine.id === selected
                ? engineState.active_model
                : !engine.available
                  ? engine.install_hint || engine.reason || engine.hint || undefined
                  : undefined,
          models: engine.curated_models,
          installable: engine.one_click_install,
          setupSnippet: !engine.available ? engine.setup_snippet || undefined : undefined,
          docsUrl: engine.docs_url || undefined,
          device: engine.effective_device || undefined,
          routingStatus: engine.routing_status || undefined,
          routingReason: engine.routing_reason || undefined,
          isolationMode: engine.isolation_mode,
          licenseRequired: engine.license_required,
          licenseAccepted: engine.license_accepted,
        }));
  if (family !== 'llm' && (family === 'dictation' ? dictation.isError : engines.isError))
    return (
      <SettingsActionError
        title={t('modelSettings.failed')}
        detail={describeError(family === 'dictation' ? dictation.error : engines.error)}
        action={
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (family === 'dictation') void dictation.refetch();
              else engines.retry();
            }}
          >
            {t('backend.retry')}
          </Button>
        }
      />
    );
  const availableRows = rows?.filter((row) => row.available);
  const unavailableRows = rows?.filter((row) => !row.available);
  const renderRow = (row: NonNullable<typeof rows>[number]) => {
    const licenseId = licensedEngine(
      row.id,
      'licenseRequired' in row ? row.licenseRequired : undefined,
      'licenseAccepted' in row ? row.licenseAccepted : undefined,
    );
    return (
      <div key={row.id}>
        <SettingsRow
          id={'engine-' + row.id}
          title={row.name}
          description={
            row.detail || row.setupSnippet ? (
              <div className="space-y-1.5">
                {row.detail && <p>{row.detail}</p>}
                {row.setupSnippet && (
                  <code className="block w-fit max-w-full overflow-x-auto rounded-md bg-muted/55 px-2 py-1 text-[11px] text-foreground/75">
                    {row.setupSnippet}
                  </code>
                )}
              </div>
            ) : undefined
          }
        >
          {!row.available && licenseId ? (
            <EngineLicense id={licenseId} name={row.name} />
          ) : !row.available && row.installable ? (
            <EngineInstall id={row.id} />
          ) : null}
          <span className="text-xs text-muted-foreground">
            {t(row.available ? 'modelSettings.available' : 'modelSettings.unavailable')}
          </span>
          {row.device && (
            <span
              title={row.routingReason || row.routingStatus}
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-muted/35 px-2 text-[11px] font-medium tracking-wide text-muted-foreground"
            >
              <ComputeVendorIcon runtime={row.device} className="size-3.5 shrink-0" />
              {formatComputeRuntime(row.device)}
            </span>
          )}
          {family !== 'dictation' && (
            <EngineHealth id={row.id} available={row.available} isolationMode={row.isolationMode} />
          )}
          {!row.available && row.docsUrl && (
            <ExternalLink href={row.docsUrl}>
              <BookOpenIcon />
              {t('common.learn_more')}
            </ExternalLink>
          )}
          {row.available && (
            <Button
              size="sm"
              variant={row.id === selected ? 'secondary' : 'outline'}
              disabled={busy || row.id === selected}
              onClick={() => void select(row.id)}
              aria-pressed={row.id === selected}
            >
              {row.id === selected ? <CheckIcon /> : null}
              {t(row.id === selected ? 'modelSettings.selected' : 'modelSettings.select')}
            </Button>
          )}
        </SettingsRow>
        {row.available &&
          row.models?.map((model) => {
            const active =
              row.id === selected &&
              (selectedModel === model.key || selectedModel === model.repo_id);
            return (
              <div
                key={model.key}
                className="flex items-center justify-between gap-4 px-6 py-2 text-sm"
              >
                <span>{model.label}</span>
                <Button
                  size="xs"
                  variant={active ? 'secondary' : 'ghost'}
                  disabled={
                    busy ||
                    active ||
                    !catalogue.data?.models.some(
                      (item) => item.repo_id === model.repo_id && item.installed,
                    )
                  }
                  aria-pressed={active}
                  onClick={() => void select(row.id, model.key)}
                >
                  {active ? <CheckIcon /> : null}
                  {t(active ? 'modelSettings.selected' : 'modelSettings.select')}
                </Button>
              </div>
            );
          })}
      </div>
    );
  };
  return (
    <>
      {family === 'llm' && (
        <>
          <LlmProviders />
          <LlmSkills />
        </>
      )}
      <SettingsSection icon={familyIcons[family]} title={t('engineSidebar.' + family)}>
        {family === 'dictation' && (
          <SettingsRow id="dictation-enabled" title={t('engineSidebar.dictation')} titleHidden>
            <Switch
              aria-label={t('engineSidebar.dictation')}
              checked={Boolean(dictation.data?.enabled)}
              disabled={
                busy ||
                !dictation.data ||
                (!dictation.data.enabled &&
                  (!dictation.data.engine_available ||
                    !dictation.data.models.some(
                      (model) => model.id === selected && model.installed,
                    )))
              }
              onCheckedChange={(value) => void setDictationEnabled(value)}
            />
          </SettingsRow>
        )}
        {family === 'llm' && engines.isError ? (
          <SettingsActionError
            className="m-4"
            title={t('modelSettings.failed')}
            detail={describeError(engines.error)}
            action={
              <Button size="xs" variant="ghost" onClick={() => engines.retry()}>
                {t('backend.retry')}
              </Button>
            }
          />
        ) : !rows ? (
          <SettingsRowsSkeleton label={t('preferences.loading')} />
        ) : (
          <>
            {availableRows?.map(renderRow)}
            {unavailableRows && unavailableRows.length > 0 && (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
                  {t('modelSettings.unavailable')}
                  <span className="text-xs tabular-nums">{unavailableRows.length}</span>
                  <ChevronRightIcon className="ml-auto size-4 transition-transform duration-150 group-open:rotate-90" />
                </summary>
                <div className="border-t border-border/50 [&>*+*]:border-t [&>*+*]:border-border/50">
                  {unavailableRows.map(renderRow)}
                </div>
              </details>
            )}
          </>
        )}
      </SettingsSection>
      {family === 'asr' && <AsrOpenAiCompatSettings />}
      {showLibrary && family !== 'llm' && <ModelLibrary family={family} />}
      {family === 'dictation' && (
        <>
          <ShortcutSettings />
          <RefinementSettings />
          <AecSettings />
        </>
      )}
      {failed && (
        <SettingsActionError
          title={t('modelSettings.failed')}
          detail={failed}
          onDismiss={() => setFailed(null)}
        />
      )}
    </>
  );
}
