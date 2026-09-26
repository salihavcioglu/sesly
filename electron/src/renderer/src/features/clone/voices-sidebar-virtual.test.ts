import { expect, it } from 'vitest';
import { profileListPresentation } from './voices-sidebar';

it('virtualizes a large sidebar library while preserving the full Profiles grid', () => {
  expect(profileListPresentation(30, false)).toBe('list');
  expect(profileListPresentation(31, false)).toBe('virtual');
  expect(profileListPresentation(100, true)).toBe('grid');
});
