import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';

function retryQuery(failureCount: number, error: unknown): boolean {
  // The native supervisor owns reconnects. Retrying every mounted query while
  // its proxy is unavailable only duplicates 502/503 traffic and console noise;
  // onlineManager resumes them once the backend reports ready again.
  if (error instanceof ApiError && [0, 502, 503].includes(error.status)) return false;
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      // The backend is local; window focus is not a signal that data changed.
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  profiles: ['profiles'] as const,
  history: ['history'] as const,
  engines: ['engines'] as const,
  systemInfo: ['system', 'info'] as const,
};
