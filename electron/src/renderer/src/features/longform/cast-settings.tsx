import { castVoice } from './cast-map';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
export function CastSettings({
  names,
  cast,
  profiles,
  disabled,
  onChange,
}: {
  names: string[];
  cast: Record<string, string>;
  profiles: { id: string; name: string }[];
  disabled: boolean;
  onChange: (cast: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  return (
    <details className="space-y-3" open={names.length > 0}>
      <summary className="cursor-pointer text-sm font-medium">{t('audiobook.cast')}</summary>
      {!names.length && (
        <p className="text-xs text-muted-foreground">{t('audiobook.cast_empty')}</p>
      )}
      {names.map((name) => (
        <details key={name} className="space-y-2">
          <summary className="cursor-pointer text-sm">
            <span className="font-medium">{name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {castVoice(cast, name)
                ? profiles.find((profile) => profile.id === castVoice(cast, name))?.name ||
                  t('modelSettings.unavailable')
                : t('audiobook.cast_uses_default')}
            </span>
          </summary>
          <div
            className="max-h-48 space-y-1 overflow-y-auto"
            role="group"
            aria-label={t('audiobook.cast') + ': ' + name}
          >
            <Button
              size="sm"
              className="w-full justify-start"
              variant={!castVoice(cast, name) ? 'secondary' : 'ghost'}
              disabled={disabled}
              onClick={() => {
                const next = { ...cast };
                delete next[name];
                onChange(next);
              }}
            >
              {t('stories.defaultVoice')}
            </Button>
            {profiles.map((profile) => (
              <Button
                key={profile.id}
                className="w-full justify-start"
                size="sm"
                variant={castVoice(cast, name) === profile.id ? 'secondary' : 'ghost'}
                disabled={disabled}
                onClick={() => onChange({ ...cast, [name]: profile.id })}
              >
                {profile.name}
              </Button>
            ))}
          </div>
        </details>
      ))}
    </details>
  );
}
