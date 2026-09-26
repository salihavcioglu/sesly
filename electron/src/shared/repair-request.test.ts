import { describe, expect, it } from 'vitest';
import { canRunRepairRequest, isAppOperationRequest } from './repair-request';

describe('repair request access', () => {
  it('allows an explicit app operation without a source checkout', () => {
    expect(isAppOperationRequest('  ACTION_REQUEST: install the selected TTS model')).toBe(true);
    expect(canRunRepairRequest('ACTION_REQUEST: activate TTS', false)).toBe(true);
  });

  it('keeps ordinary diagnosis and code repair behind a source checkout', () => {
    expect(
      isAppOperationRequest('Logs mention ACTION_REQUEST: but this is not an app action'),
    ).toBe(false);
    expect(canRunRepairRequest('Diagnose this renderer crash', false)).toBe(false);
    expect(canRunRepairRequest('Diagnose this renderer crash', true)).toBe(true);
  });
});
