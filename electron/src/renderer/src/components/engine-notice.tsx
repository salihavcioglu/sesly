import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, TriangleAlertIcon, WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTtsReadiness } from '@/hooks/use-tts-readiness';
import {
  modelInstallJobTarget,
  TERMINAL_MODEL_INSTALL_STATES,
  useModelInstallJobs,
} from '@/hooks/use-model-install-sync';
import { apiJson, describeError } from '@/lib/api/client';
import { openRepairAgent } from '@/lib/repair-agent-events';
import type { EnginesResponse } from '@/lib/api/types';

interface RecommendedModel {
  repo_id: string;
  role: string;
  required: boolean;
  installed: boolean;
}

interface ModelRecommendations {
  target?: string;
  models: RecommendedModel[];
}

export function EngineNotice({
  operation = 'tts',
  requireLocal = false,
  compact = false,
}: {
  operation?: string;
  requireLocal?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [fixing, setFixing] = useState(false);
  const [install, setInstall] = useState<{
    repo: string;
    target: string;
  } | null>(null);
  const installSeen = useRef(false);
  const jobs = useModelInstallJobs();
  const blocker = useTtsReadiness(operation, requireLocal);
  const job = jobs.data?.jobs.find(
    (item) => item.repo_id === install?.repo && modelInstallJobTarget(item) === install?.target,
  );
  const progress =
    job?.total_bytes && job.total_bytes > 0
      ? Math.min(100, Math.round(((job.bytes_done ?? 0) / job.total_bytes) * 100))
      : null;

  const refreshReadiness = useCallback(
    () =>
      Promise.all(
        [
          'model-install-jobs',
          'model-catalogue',
          'model-recommendations',
          'engines',
          'workers',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      ),
    [client],
  );

  const repair = useCallback(
    (detail: string) => {
      openRepairAgent(
        `ACTION_REQUEST: Restore text-to-speech readiness for operation "${operation}". ${detail}`,
        true,
      );
    },
    [operation],
  );

  const activateAvailableEngine = useCallback(async (): Promise<boolean> => {
    const engines = await apiJson<EnginesResponse>('/engines');
    const current = engines.tts.backends.find((backend) => backend.id === engines.tts.active);
    if (current?.available) {
      await refreshReadiness();
      return true;
    }
    const available = engines.tts.backends.filter(
      (backend) => backend.available && backend.routing_status !== 'unavailable',
    );
    const candidate = available.find((backend) => backend.id === 'omnivoice') ?? available[0];
    if (!candidate) return false;
    await apiJson('/engines/select', {
      method: 'POST',
      body: JSON.stringify({ family: 'tts', backend_id: candidate.id }),
    });
    await refreshReadiness();
    return true;
  }, [refreshReadiness]);

  useEffect(() => {
    if (!install || !jobs.data) return;
    if (job && !TERMINAL_MODEL_INSTALL_STATES.has(job.state)) {
      installSeen.current = true;
      return;
    }
    if (!installSeen.current && !job) return;
    const completed = !job || job.state === 'done';
    const detail = job?.error || job?.state || 'The model installer stopped before completion.';
    setInstall(null);
    installSeen.current = false;
    if (!completed) {
      if (!['cancelled', 'install_cancelled'].includes(job?.state ?? '')) repair(detail);
      return;
    }
    void (async () => {
      try {
        if (install.target === 'local' && !(await activateAvailableEngine())) {
          repair('The model installed, but no compatible local TTS engine became available.');
        } else {
          await refreshReadiness();
        }
      } catch (error) {
        repair(`The model installed, but activation failed: ${describeError(error)}`);
      }
    })();
  }, [activateAvailableEngine, install, job, jobs.data, refreshReadiness, repair]);

  if (blocker !== 'engine') return null;
  const fix = async () => {
    setFixing(true);
    try {
      const recommendation = await apiJson<ModelRecommendations>('/setup/recommendations');
      const missing = recommendation.models.find(
        (item) => item.required && item.role.toLowerCase() === 'tts' && !item.installed,
      );
      if (!missing) {
        if (recommendation.target !== 'local' || !(await activateAvailableEngine())) {
          repair(
            'The required model is installed, but no compatible engine is ready. Diagnose the live engine state and complete supported app-level recovery.',
          );
        }
        return;
      }
      const target = recommendation.target ?? 'local';
      const existing = jobs.data?.jobs.find(
        (item) =>
          item.repo_id === missing.repo_id &&
          modelInstallJobTarget(item) === target &&
          !TERMINAL_MODEL_INSTALL_STATES.has(item.state),
      );
      installSeen.current = false;
      setInstall({ repo: missing.repo_id, target });
      if (existing) {
        installSeen.current = true;
        return;
      }
      await apiJson('/models/install', {
        method: 'POST',
        body: JSON.stringify({ repo_id: missing.repo_id, target }),
      });
      await client.invalidateQueries({ queryKey: ['model-install-jobs'] });
      toast.success(t('models.started_downloading', { count: 1 }));
    } catch (error) {
      setInstall(null);
      installSeen.current = false;
      repair(`Automatic model setup failed: ${describeError(error)}`);
    } finally {
      setFixing(false);
    }
  };
  const action = (
    <Button
      type="button"
      size="sm"
      className={compact ? 'shrink-0' : 'mt-2'}
      disabled={fixing || Boolean(install)}
      onClick={fix}
    >
      {fixing || install ? (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
      ) : (
        <WrenchIcon />
      )}
      {install
        ? `${t('modelMaintenance.downloading')}${progress === null ? '' : ` ${progress}%`}`
        : t('repairAgent.fix')}
    </Button>
  );
  if (compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
        <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
        <div className="min-w-48 flex-1">
          <p className="font-medium text-foreground">{t('engines.none_ready_title')}</p>
          <p className="text-xs leading-5 text-muted-foreground">{t('engines.none_ready_body')}</p>
        </div>
        {action}
      </div>
    );
  }
  return (
    <Alert className="border-warning/40 bg-warning/10 text-foreground">
      <TriangleAlertIcon className="text-warning" />
      <AlertTitle>{t('engines.none_ready_title')}</AlertTitle>
      <AlertDescription>
        <p>{t('engines.none_ready_body')}</p>
        {action}
      </AlertDescription>
    </Alert>
  );
}
