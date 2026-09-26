import type { ComponentProps } from 'react';
import { useEngines } from '@/hooks/use-engines';
import { LanguagePicker } from './language-picker';

/** Output language only: reference recordings and translation targets stay independent. */
export function EngineLanguagePicker(props: ComponentProps<typeof LanguagePicker>) {
  const { activeTts } = useEngines();
  return <LanguagePicker {...props} supportedOptions={activeTts?.supported_language_names} />;
}
