import { WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { openRepairAgent } from '@/lib/repair-agent-events';
import { cn } from '@/lib/utils';

export function AgentFixButton({ request, className }: { request: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn('shrink-0', className)}
      onClick={() => openRepairAgent(`ACTION_REQUEST: ${request}`, true)}
    >
      <WrenchIcon />
      {t('repairAgent.fix')}
    </Button>
  );
}
