import { describe, expect, it } from 'vitest';
import { logSeverity, stripLogAnsi } from './log-format';

describe('log formatting', () => {
  it.each([
    ['2026-09-12 ERROR backend crashed', 'error'],
    ['Traceback (most recent call last):', 'error'],
    ['WARNING model is retrying', 'warning'],
    ['INFO Application startup complete.', 'success'],
    ['DEBUG request headers', 'debug'],
    ['INFO GET /health 200', 'info'],
  ])('classifies %s as %s', (line, severity) => {
    expect(logSeverity(line)).toBe(severity);
  });

  it('removes terminal color escapes before display', () => {
    expect(stripLogAnsi('\u001B[31mERROR\u001B[0m failed')).toBe('ERROR failed');
  });
});
