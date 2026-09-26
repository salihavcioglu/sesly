import { Link } from '@tanstack/react-router';
import { AlertCircleIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SettingsActionError({
  title,
  detail,
  action,
  onDismiss,
  className,
}: {
  title: string;
  detail?: string | null;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-destructive',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{title}</span>
        {action}
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('common.dismiss')}
            onClick={onDismiss}
          >
            <XIcon />
          </Button>
        )}
      </div>
      {detail && (
        <details className="mt-1 pl-6 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded py-1 focus-visible:outline-ring">
            {t('profileIdentity.details')}
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 font-mono text-xs">
            {detail}
          </pre>
          <Link to="/settings/logs" className="mt-2 inline-block underline">
            {t('settings.logs')}
          </Link>
        </details>
      )}
    </div>
  );
}
