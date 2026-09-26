import { AlertTriangleIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export interface ScriptWarning {
  type: string;
  name?: string;
  title?: string;
  tag?: string;
}

export function ValidationWarnings({
  warnings,
  onDismiss,
}: {
  warnings: ScriptWarning[];
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  if (!warnings.length) return null;

  const message = (warning: ScriptWarning) => {
    if (warning.type === 'unknown_voice')
      return t('audiobook.warn_unknown_voice', { name: warning.name });
    if (warning.type === 'empty_chapter')
      return t('audiobook.warn_empty_chapter', {
        title: warning.title || t('audiobook.untitled'),
      });
    if (warning.type === 'unknown_tag')
      return t('audiobook.warn_unknown_tag', { tag: warning.tag });
    return '';
  };

  return (
    <div
      role="status"
      className="rounded-xl border border-warning/30 bg-warning/5 p-3"
    >
      <div className="flex items-center gap-2">
        <AlertTriangleIcon className="size-4 text-warning" />
        <p className="text-xs font-medium">{t('audiobook.warnings_title')}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label={t('audiobook.dismiss')}
          title={t('audiobook.dismiss')}
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
        {warnings.map((warning, index) => (
          <li key={`${warning.type}:${index}`}>{message(warning)}</li>
        ))}
      </ul>
    </div>
  );
}
