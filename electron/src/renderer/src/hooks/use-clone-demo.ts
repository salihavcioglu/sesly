import { useCloneSetting } from '@/lib/store/clone-settings';
import { useTtsReadiness } from './use-tts-readiness';

export function useCloneDemo() {
  const profile = useCloneSetting('selectedProfileId');
  const readiness = useTtsReadiness();
  return profile === 'demo0001' && readiness === 'engine';
}
