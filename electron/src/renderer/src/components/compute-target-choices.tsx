import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { selectComputeTarget, type ComputeTargetState } from '@/hooks/use-compute-target';

function statusClass(status: string) {
  if (status === 'ready') return 'bg-success';
  if (status === 'busy') return 'bg-warning';
  return 'bg-muted-foreground/45';
}

export function ComputeTargetChoices({
  data,
  disabled = false,
  onSelected,
}: {
  data?: ComputeTargetState;
  disabled?: boolean;
  onSelected?: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [saving, setSaving] = useState('');
  if (!data || data.targets.length <= 1) return null;

  const choose = async (target: string) => {
    if (saving || target === data.target) return;
    setSaving(target);
    try {
      await selectComputeTarget(client, target);
      onSelected?.();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSaving('');
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('compute.title')}
      className="space-y-1 rounded-lg border border-border/55 bg-muted/20 p-1"
    >
      {data.targets.map((target) => {
        const selected = target.id === data.target;
        const activity =
          target.active_tasks > 0
            ? `${target.active_tasks}/${target.max_tasks}`
            : target.latency_ms > 0
              ? `${Math.round(target.latency_ms)} ms`
              : '';
        return (
          <button
            key={target.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || Boolean(saving)}
            onClick={() => void choose(target.id)}
            className={cn(
              'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-[background-color,box-shadow] duration-150 hover:bg-accent/65 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60',
              selected &&
                'bg-accent text-accent-foreground',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {saving === target.id ? (
                <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : selected ? (
                <CheckIcon className="size-3.5" />
              ) : null}
            </span>
            {!target.is_local && (
              <span className={cn('size-1.5 shrink-0 rounded-full', statusClass(target.status))} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{target.label}</span>
              {!target.is_local && (
                <span className="block truncate text-[10px] text-muted-foreground">
                  {target.detail || target.endpoint}
                </span>
              )}
            </span>
            {activity && (
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                {activity}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
