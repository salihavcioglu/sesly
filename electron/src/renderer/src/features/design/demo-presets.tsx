import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AudioPreviewButton } from '@/components/audio-preview-button';
import { Button } from '@/components/ui/button';
import { apiJson, apiPath } from '@/lib/api/client';

export interface DemoPreset {
  id: string;
  name: string;
  description: string;
  attrs: Record<string, string>;
  script: string;
  language: string;
  preview_url: string;
  is_demo: boolean;
}
export function DemoPresets({
  disabled,
  onUse,
  initialOpen = false,
}: {
  initialOpen?: boolean;
  disabled: boolean;
  onUse: (preset: DemoPreset) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initialOpen);
  const query = useQuery({
    queryKey: ['personalities'],
    queryFn: ({ signal }) => apiJson<DemoPreset[]>('/personalities', { signal }),
    staleTime: Infinity,
  });
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="shrink-0 space-y-3"
    >
      <summary className="cursor-pointer text-sm font-medium">{t('demo.hear_demo')}</summary>
      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        {query.data
          ?.filter((preset) => preset.is_demo)
          .map((preset) => (
            <article
              key={preset.id}
              className="min-w-0 space-y-2 rounded-lg border border-border/50 p-3"
            >
              <h3 className="text-sm font-medium">{preset.name}</h3>
              <p className="text-xs leading-5 text-muted-foreground">{preset.description}</p>
              <div className="flex items-center justify-between gap-2">
                <AudioPreviewButton
                  src={apiPath(preset.preview_url)}
                  source={'design-demo-' + preset.id}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    onUse(preset);
                    setOpen(false);
                  }}
                >
                  {t('demo.preset_use')}
                </Button>
              </div>
            </article>
          ))}
      </div>
    </details>
  );
}
