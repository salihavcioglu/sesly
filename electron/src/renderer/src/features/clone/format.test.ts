import { describe, expect, it } from 'vitest';
import { formatRelative } from './format';

describe('formatRelative', () => {
  const now = Date.UTC(2026, 8, 10, 12, 0, 0);
  it('accepts the backend epoch-seconds REAL column', () => {
    expect(formatRelative(now / 1000 - 3600, 'en', now)).toBe('1 hour ago');
  });
  it('accepts epoch milliseconds and ISO strings', () => {
    expect(formatRelative(now - 2 * 86_400_000, 'en', now)).toBe('2 days ago');
    expect(formatRelative('2026-09-10T11:59:30', 'en', now)).toBe('30 seconds ago');
  });
  it('returns an empty string for missing or malformed stamps', () => {
    expect(formatRelative(null, 'en', now)).toBe('');
    expect(formatRelative('not a date', 'en', now)).toBe('');
  });
});
