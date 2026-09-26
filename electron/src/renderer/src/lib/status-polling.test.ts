import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATUS_POLL_MS,
  IDLE_COMPUTE_TARGET_POLL_MS,
  IDLE_STATUS_POLL_MS,
  batchStatusPollMs,
  computeTargetPollMs,
  loadedModelsPollMs,
  modelStatusPollMs,
} from './status-polling';

describe('runtime status polling', () => {
  it('keeps active work responsive and backs off idle fallback requests', () => {
    expect(modelStatusPollMs(1, 'ready')).toBe(ACTIVE_STATUS_POLL_MS);
    expect(modelStatusPollMs(0, 'loading')).toBe(ACTIVE_STATUS_POLL_MS);
    expect(batchStatusPollMs(1)).toBe(ACTIVE_STATUS_POLL_MS);
    expect(loadedModelsPollMs(true)).toBe(ACTIVE_STATUS_POLL_MS);
    expect(computeTargetPollMs(1)).toBe(ACTIVE_STATUS_POLL_MS);

    expect(modelStatusPollMs(0, 'ready')).toBe(IDLE_STATUS_POLL_MS);
    expect(batchStatusPollMs(0)).toBe(IDLE_STATUS_POLL_MS);
    expect(loadedModelsPollMs(false)).toBe(IDLE_STATUS_POLL_MS);
    expect(computeTargetPollMs(0)).toBe(IDLE_COMPUTE_TARGET_POLL_MS);
  });
});
