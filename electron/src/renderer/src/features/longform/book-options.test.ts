import { expect, it } from 'vitest';
import { restoreBookOptions, lexiconMap } from './book-options';
it('restores older drafts with backend-default book options', () => {
  expect(restoreBookOptions(null)).toEqual({
    metadata: {},
    loudness: 'off',
    cover: null,
    lexicon: [],
  });
});
it('keeps supported metadata and rejects conflicting pronunciation rows', () => {
  expect(
    restoreBookOptions({
      metadata: { author: 'Author' },
      cover: { path: '/cover.png', name: 'Cover' },
    }),
  ).toMatchObject({ metadata: { author: 'Author' }, cover: { name: 'Cover' } });
  expect(() =>
    lexiconMap([
      { word: 'SQL', pronunciation: 'sequel' },
      { word: ' sql ', pronunciation: 'letters' },
    ]),
  ).toThrow();
});
