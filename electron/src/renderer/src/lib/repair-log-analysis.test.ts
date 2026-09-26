import { describe, expect, it } from 'vitest';
import { collectRepairLogLines, repairLogCause } from './repair-log-analysis';

describe('repair log analysis', () => {
  it('keeps unique problem lines and drops routine activity', () => {
    expect(
      collectRepairLogLines([
        'INFO backend ready',
        'WARNING retrying download',
        'WARNING retrying download',
        'ERROR request failed',
      ]),
    ).toEqual(['WARNING retrying download', 'ERROR request failed']);
  });

  it.each([
    ['403 Client Error: Cannot access gated repo', 'hfAccess'],
    ['CUDA out of memory while loading model', 'memory'],
    ['EADDRINUSE: port 3900 is already in use', 'port'],
    ["ModuleNotFoundError: No module named 'torch'", 'brokenRuntime'],
  ])('recognizes %s', (line, cause) => {
    expect(repairLogCause([line])).toBe(cause);
  });
});
