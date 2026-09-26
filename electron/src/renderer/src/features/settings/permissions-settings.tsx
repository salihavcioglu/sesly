import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  KeyboardIcon,
  LockKeyholeIcon,
  MicIcon,
  RotateCwIcon,
} from 'lucide-react';
import type { NativePermissions, NativePermissionStatus } from '../../../../preload/index.d';
import { getBridge } from '@/components/bridge';
import { PipelineFailure } from '@/components/pipeline-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/client';
import { SettingsRow, SettingsSection } from './settings-layout';

function PermissionBadge({ status }: { status: NativePermissionStatus }) {
  const { t } = useTranslation();
  if (status === 'granted') {
    return (
      <Badge className="border-success/20 bg-success/12 text-success dark:text-success">
        <CheckCircle2Icon />
        {t('permissions.status_granted')}
      </Badge>
    );
  }
  if (status === 'denied') {
    return (
      <Badge variant="destructive">
        <AlertCircleIcon />
        {t('permissions.status_denied')}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {t(status === 'prompt' ? 'permissions.status_prompt' : 'permissions.status_unknown')}
    </Badge>
  );
}

export function PermissionsSettings() {
  const { t } = useTranslation();
  const bridge = getBridge();
  const [state, setState] = useState<NativePermissions | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const recheck = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    setError('');
    try {
      setState(await bridge.permissions.getState());
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  useEffect(() => {
    void recheck();
  }, [recheck]);
  useEffect(() => {
    const focused = () => void recheck();
    window.addEventListener('focus', focused);
    return () => window.removeEventListener('focus', focused);
  }, [recheck]);

  const open = async (kind: 'microphone' | 'accessibility') => {
    if (!bridge) return;
    setError('');
    try {
      await bridge.permissions.openSettings(kind);
    } catch (error) {
      setError(describeError(error));
    }
  };

  return (
    <SettingsSection icon={LockKeyholeIcon} title={t('permissions.title')}>
      <SettingsRow
        id="permissions-overview"
        title={t('permissions.title')}
        titleHidden
        description={t('permissions.desc')}
      >
        {bridge && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void recheck()}>
            <RotateCwIcon className={busy ? 'animate-spin' : undefined} />
            {t('setup.recheck')}
          </Button>
        )}
      </SettingsRow>
      {!bridge && (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t('permissions.web_note')}</p>
      )}
      {error && (
        <div className="p-4">
          <PipelineFailure fallback={error} onDismiss={() => setError('')} />
        </div>
      )}
      {state && (
        <>
          <SettingsRow
            id="permission-microphone"
            title={t('permissions.microphone')}
            description={t('permissions.microphone_why')}
          >
            <MicIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <PermissionBadge status={state.microphone} />
            {state.microphone === 'denied' && state.platform !== 'linux' && (
              <Button variant="ghost" size="sm" onClick={() => void open('microphone')}>
                {t('permissions.open_settings')}
              </Button>
            )}
          </SettingsRow>
          {state.platform === 'darwin' && state.accessibility && (
            <SettingsRow
              id="permission-accessibility"
              title={t('permissions.accessibility')}
              description={t('permissions.accessibility_why')}
            >
              <KeyboardIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <PermissionBadge status={state.accessibility} />
              {state.accessibility === 'denied' && (
                <Button variant="ghost" size="sm" onClick={() => void open('accessibility')}>
                  {t('permissions.open_settings')}
                </Button>
              )}
            </SettingsRow>
          )}
        </>
      )}
    </SettingsSection>
  );
}
