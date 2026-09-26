import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HuggingFaceToken } from '@/features/settings/credential-settings';
import { NetworkSettings } from '@/features/settings/network-settings';
import { MirrorSettings } from '@/features/settings/mirror-settings';
import { MediaTools } from '@/features/settings/media-tools';

const sections = [
  { label: 'settings.credentials', Content: HuggingFaceToken },
  { label: 'settings.network', Content: NetworkRecovery },
  { label: 'settings.audio_tools', Content: MediaTools },
];
function NetworkRecovery() {
  return (
    <div className="space-y-5">
      <NetworkSettings />
      <MirrorSettings />
    </div>
  );
}

export function SetupRecovery() {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  return (
    <div className="divide-y divide-border/50 border-t border-border/50">
      {sections.map(({ label, Content }) => (
        <details
          key={label}
          className="space-y-4 py-3"
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setOpened((current) => ({ ...current, [label]: open }));
          }}
        >
          <summary className="cursor-pointer text-sm font-medium">{t(label)}</summary>
          {opened[label] && <Content />}
        </details>
      ))}
    </div>
  );
}
