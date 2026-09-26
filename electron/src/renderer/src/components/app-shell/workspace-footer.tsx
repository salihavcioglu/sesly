import { useNavigate } from '@tanstack/react-router';
import { BlocksIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { runRendererTask } from '@/lib/global-error-recovery';
import './workspace-footer.css';

/** Lives in the content column, so it never covers the editor or its sidebar. */
export function WorkspaceFooter() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="workspace-footer-host">
      <footer aria-label={t('integrationCatalog.title')} className="workspace-footer-strip">
        <button
          type="button"
          className="workspace-footer-action"
          onClick={() =>
            runRendererTask('Open integrations', () => navigate({ to: '/integrations' }))
          }
        >
          <BlocksIcon aria-hidden="true" className="size-4" />
          <span>{t('integrationCatalog.title')}</span>
        </button>
      </footer>
    </div>
  );
}
