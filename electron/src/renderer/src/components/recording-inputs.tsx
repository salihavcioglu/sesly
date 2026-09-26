import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UseRecording } from '@/hooks/use-recording';
const DEFAULT_INPUT = '__default__';
export function RecordingInputs({
  rec,
  disabled = false,
}: {
  rec: UseRecording;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const busy = disabled || rec.isStarting || rec.isRecording || rec.isCleaning;
  const deviceId = useId();
  const channelsId = useId();

  const inputItems = [
    { value: DEFAULT_INPUT, label: t('recording.default_input') },
    ...rec.inputs
      .filter((d) => d.deviceId)
      .map((d, i) => ({
        value: d.deviceId,
        label: d.label || t('recording.microphone_number', { number: i + 1 }),
      })),
  ];
  const channelItems = (['auto', 'mono', 'stereo'] as const).map((value) => ({
    value,
    label: t(`recording.channels_${value}`),
  }));

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={deviceId} className="text-[length:var(--text-label)] text-muted-foreground">
          {t('recording.input_device')}
        </Label>
        <Select
          items={inputItems}
          value={rec.selectedInputId || DEFAULT_INPUT}
          onValueChange={(value) => {
            if (!busy && typeof value === 'string') {
              rec.setSelectedInputId(value === DEFAULT_INPUT ? '' : value);
            }
          }}
          disabled={busy}
        >
          <SelectTrigger id={deviceId} className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {inputItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label
          htmlFor={channelsId}
          className="text-[length:var(--text-label)] text-muted-foreground"
        >
          {t('recording.channels')}
        </Label>
        <Select
          items={channelItems}
          value={rec.channelMode}
          onValueChange={(value) => {
            if (!busy && (value === 'auto' || value === 'mono' || value === 'stereo')) {
              rec.setChannelMode(value);
            }
          }}
          disabled={busy}
        >
          <SelectTrigger id={channelsId} className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channelItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
