import { SparklesIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiJson } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsSection, SettingsRow } from './settings-layout';
import { useLlmProviderCatalogue } from './llm-providers';
export interface LlmSkill {
  id: string;
  name_key: string;
  description_key: string;
  enabled: boolean;
  provider_override: string | null;
  provider_display_name: string;
  ready: boolean;
}

export function useLlmSkills() {
  return useQuery({
    queryKey: ['llm-skills'],
    queryFn: ({ signal }) =>
      apiJson<{ skills: LlmSkill[] }>('/api/settings/llm-skills', { signal }),
    staleTime: 30_000,
  });
}

const agentFitSkillIds = ['cinematic_translation', 'slot_fitting'];

export function agentFitSkillsReady(data: { skills: LlmSkill[] } | undefined): boolean {
  return agentFitSkillIds.every((id) =>
    data?.skills.some((skill) => skill.id === id && skill.enabled && skill.ready),
  );
}

export function LlmSkills() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const providers = useLlmProviderCatalogue();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const skills = useLlmSkills();
  const update = async (id: string, patch: { enabled?: boolean; provider_override?: string }) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      const data = await apiJson<{ skills: LlmSkill[] }>(
        '/api/settings/llm-skills/' + encodeURIComponent(id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      client.setQueryData(['llm-skills'], data);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <SettingsSection icon={SparklesIcon} title={t('settings.llm_skills')}>
      <p className="p-4 text-sm text-muted-foreground">{t('settings.llmskills_desc')}</p>
      {(skills.isError || providers.isError) && (
        <Button
          variant="outline"
          onClick={() => {
            void skills.refetch();
            void providers.refetch();
          }}
        >
          {t('backend.retry')}
        </Button>
      )}
      {skills.isPending && (
        <p role="status" className="p-4">
          {t('common.loading')}
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {t('settings.llmskills_save_failed')}
        </p>
      )}
      {skills.data?.skills.map((skill) => (
        <SettingsRow
          key={skill.id}
          id={'skill-' + skill.id}
          title={t(skill.name_key)}
          description={t(skill.description_key)}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-3">
              {skill.enabled && (
                <span role="status" className="text-xs text-muted-foreground">
                  {t(skill.ready ? 'settings.llmskills_ready' : 'settings.llmskills_needs_setup')}
                </span>
              )}
              <Switch
                aria-label={t(skill.name_key)}
                checked={skill.enabled}
                disabled={busy}
                onCheckedChange={(enabled) => void update(skill.id, { enabled })}
              />
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-right">
                {skill.provider_display_name || t('settings.llmskills_use_active')}
              </summary>
              <div className="mt-2 flex max-w-sm flex-wrap justify-end gap-1">
                <Button
                  size="xs"
                  variant={!skill.provider_override ? 'secondary' : 'ghost'}
                  aria-pressed={!skill.provider_override}
                  disabled={busy || !skill.enabled}
                  onClick={() => void update(skill.id, { provider_override: '' })}
                >
                  {t('settings.llmskills_use_active')}
                </Button>
                {providers.data?.providers
                  .filter(
                    (provider) => provider.configured || provider.id === skill.provider_override,
                  )
                  .map((provider) => (
                    <Button
                      key={provider.id}
                      size="xs"
                      variant={skill.provider_override === provider.id ? 'secondary' : 'ghost'}
                      aria-pressed={skill.provider_override === provider.id}
                      disabled={busy || !skill.enabled}
                      onClick={() => void update(skill.id, { provider_override: provider.id })}
                    >
                      {provider.display_name}
                      {provider.local ? ' (' + t('settings.llmp_local_tag') + ')' : ''}
                    </Button>
                  ))}
              </div>
            </details>
          </div>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}
