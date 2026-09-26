export const ACTIVE_STATUS_POLL_MS = 1_000;
export const IDLE_STATUS_POLL_MS = 30_000;
export const IDLE_COMPUTE_TARGET_POLL_MS = 15_000;

export function modelStatusPollMs(activityCount: number, status?: string): number {
  return activityCount > 0 || status === 'loading' ? ACTIVE_STATUS_POLL_MS : IDLE_STATUS_POLL_MS;
}

export function batchStatusPollMs(jobCount: number): number {
  return jobCount > 0 ? ACTIVE_STATUS_POLL_MS : IDLE_STATUS_POLL_MS;
}

export function loadedModelsPollMs(active: boolean): number {
  return active ? ACTIVE_STATUS_POLL_MS : IDLE_STATUS_POLL_MS;
}

export function computeTargetPollMs(activeTasks: number | undefined): number {
  return activeTasks ? ACTIVE_STATUS_POLL_MS : IDLE_COMPUTE_TARGET_POLL_MS;
}
