import { expect, it, vi } from 'vitest';
import { apiJson } from '@/lib/api/client';
import { favoriteCatalogue, FAVORITES_KEY, readFavorites } from './favorites';
vi.mock('@/lib/api/client', () => ({ apiJson: vi.fn() }));
it('fetches matching voices beyond the first catalogue page', async () => {
  vi.mocked(apiJson)
    .mockResolvedValueOnce({ items: [{ id: 'first' }], total: 2 })
    .mockResolvedValueOnce({ items: [{ id: 'favorite-on-later-page' }], total: 2 });
  const results = await favoriteCatalogue({ gender: 'female' }, new AbortController().signal);
  expect(results.map((item) => item.id)).toEqual(['first', 'favorite-on-later-page']);
  expect(vi.mocked(apiJson).mock.calls[1][0]).toContain('offset=1');
  expect(vi.mocked(apiJson).mock.calls[1][0]).toContain('gender=female');
});
it('ignores malformed storage and deduplicates saved IDs', () => {
  localStorage.setItem(FAVORITES_KEY, 'invalid');
  expect(readFavorites()).toEqual([]);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(['voice', null, 'voice', 4]));
  expect(readFavorites()).toEqual(['voice']);
});
