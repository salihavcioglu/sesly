import { describe, expect, it } from 'vitest';

const rendererSources = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('detached renderer tasks', () => {
  it('observes every fire-and-forget route transition', () => {
    const rawDetachedNavigation = /\bvoid\s+(?:(?:router\.)?navigate|item\.run)\s*\(/;
    const offenders = Object.entries(rendererSources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, source]) => rawDetachedNavigation.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
