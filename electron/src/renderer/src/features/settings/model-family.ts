import {
  AudioLinesIcon,
  BrainCircuitIcon,
  KeyboardIcon,
  LanguagesIcon,
  MicIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react';

export const modelFamilies = [
  'tts',
  'asr',
  'dictation',
  'diarisation',
  'translation',
  'llm',
] as const;

export type ModelFamily = (typeof modelFamilies)[number];

export const familyIcons: Record<ModelFamily, LucideIcon> = {
  tts: AudioLinesIcon,
  asr: MicIcon,
  dictation: KeyboardIcon,
  diarisation: UsersRoundIcon,
  translation: LanguagesIcon,
  llm: BrainCircuitIcon,
};
