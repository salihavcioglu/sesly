import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIcon, CheckIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiJson, describeError } from '@/lib/api/client';
import { queryKeys } from '@/lib/query';

type HealthResult = {
  id: string;
  ok: boolean;
  message: string;
  latency_ms: number;
};

export function EngineHealth({
  id,
  available,
  isolationMode,
}: {
  id: string;
  available: boolean;
  isolationMode?: 'in-process' | 'subprocess';
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setFailed(null);
    try {
      const next = await apiJson<HealthResult>(`/engines/${encodeURIComponent(id)}/health`);
      setResult(next);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.engines }),
        client.invalidateQueries({ queryKey: ['loaded-models'] }),
        client.invalidateQueries({ queryKey: ['sidebar-model-status'] }),
      ]);
    } catch (error) {
      setResult(null);
      setFailed(describeError(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        disabled={checking}
        onClick={() => void check()}
        title={result?.message || failed || undefined}
      >
        {checking ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : available ? (
          <ActivityIcon />
        ) : (
          <RotateCwIcon />
        )}
        {t(
          checking
            ? available
              ? 'engines.testing'
              : 'engines.rechecking'
            : available
              ? 'engines.testEngine'
              : 'engines.recheck',
        )}
      </Button>
      {result?.ok && isolationMode !== 'subprocess' ? (
        <span
          role="status"
          title={result.message}
          className="inline-flex size-5 items-center justify-center text-success"
        >
          <CheckIcon className="size-3.5" />
          <span className="sr-only">{t('modelSettings.available')}</span>
        </span>
      ) : result ? (
        <span
          role="status"
          title={result.message}
          className={
            result.ok
              ? 'text-xs font-medium text-success'
              : 'text-xs font-medium text-destructive'
          }
        >
          {result.ok
            ? t('engines.latencyMs', { ms: Math.round(result.latency_ms) })
            : t('engines.failed')}
        </span>
      ) : null}
      {failed && (
        <span role="alert" title={failed} className="text-xs font-medium text-destructive">
          {t('engines.failed')}
        </span>
      )}
    </div>
  );
}
