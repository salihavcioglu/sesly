import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBackendStatus } from './use-backend-status';
import { apiJson } from '@/lib/api/client';
export const dictationPreferencesKey = ['dictation-shortcut-prefs'];
export const nativeShortcutKey = ['native-shortcut'];

export function useDictationPreferences(enabled = true) {
  return useQuery({
    queryKey: dictationPreferencesKey,
    enabled,
    queryFn: () => apiJson<{ enabled: boolean; mode: 'hold' | 'toggle' }>('/dictation/prefs'),
    refetchInterval: 10000,
  });
}

export function useNativeShortcut(enabled = true) {
  const api = window.sesly?.capture;
  return useQuery({
    queryKey: nativeShortcutKey,
    enabled: enabled && Boolean(api),
    queryFn: () => api!.getShortcut(),
  });
}

export function NativeDictationSync() {
  const api = window.sesly?.capture;
  const backend = useBackendStatus();
  const prefs = useDictationPreferences(!!api && backend.stage === 'ready');
  const client = useQueryClient();
  useEffect(() => {
    if (!api || !prefs.data) return;
    void api
      .syncPreferences({ enabled: prefs.data.enabled, mode: prefs.data.mode })
      .then((state) => client.setQueryData(nativeShortcutKey, state))
      .catch(() => {});
  }, [api, prefs.data?.enabled, prefs.data?.mode, client]);
  return null;
}
