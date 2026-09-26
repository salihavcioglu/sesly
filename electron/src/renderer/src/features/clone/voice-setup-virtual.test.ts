import { expect, it } from 'vitest';
import { voiceGridPresentation } from './voice-setup';

it('windows only large voice-choice grids', () => {
  expect(voiceGridPresentation(30)).toBe('grid');
  expect(voiceGridPresentation(31)).toBe('virtual');
});
