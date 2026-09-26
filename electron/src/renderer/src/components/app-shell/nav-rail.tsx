import { Link } from '@tanstack/react-router';
import { FingerprintIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function NavRail() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.primary')}
      className="flex w-14 shrink-0 flex-col items-center border-r border-border/60 bg-sidebar py-4"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/clone"
              aria-label={t('nav.clone')}
              className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <FingerprintIcon className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="right">{t('nav.clone')}</TooltipContent>
      </Tooltip>
    </nav>
  );
}
