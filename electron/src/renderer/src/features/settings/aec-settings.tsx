import { Volume2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { setAecEnabled, useAecEnabled } from '@/lib/store/dictation-settings';
import { SettingsRow, SettingsSection } from './settings-layout';

export function AecSettings() {
  const { t } = useTranslation();
  const enabled = useAecEnabled();
  return (
    <SettingsSection icon={Volume2Icon} title={t('dictation.aec_title')}>
      <SettingsRow
        id="dictation-aec"
        title={t('dictation.aec_row_title')}
        description={`${t('dictation.aec_description')} ${t('dictation.aec_hint')}`}
      >
        <span className="text-xs text-muted-foreground">{t('dictation.aec_experimental')}</span>
        <Switch
          checked={enabled}
          aria-label={t('dictation.aec_row_title')}
          onCheckedChange={setAecEnabled}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
