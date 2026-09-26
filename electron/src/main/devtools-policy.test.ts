import { describe, expect, it } from 'vitest';
import { shouldOpenDevTools } from './devtools-policy';

describe('development tools policy', () => {
  it('keeps DevTools closed unless the developer explicitly opts in', () => {
    expect(shouldOpenDevTools({})).toBe(false);
    expect(shouldOpenDevTools({ SESLY_OPEN_DEVTOOLS: '0' })).toBe(false);
    expect(shouldOpenDevTools({ SESLY_OPEN_DEVTOOLS: '1' })).toBe(true);
  });
});
