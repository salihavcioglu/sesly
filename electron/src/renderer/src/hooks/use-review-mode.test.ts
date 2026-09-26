import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

it('defaults to staged review and persists an explicit straight-through choice', async () => {
  const first = await import('./use-review-mode');
  const hook = renderHook(() => first.useReviewMode());
  expect(hook.result.current).toBe('on');

  act(() => first.setReviewMode('off'));
  expect(hook.result.current).toBe('off');
  expect(localStorage.getItem('sesly.review-mode.v1')).toBe('off');
  hook.unmount();

  vi.resetModules();
  const restored = await import('./use-review-mode');
  const restoredHook = renderHook(() => restored.useReviewMode());
  expect(restoredHook.result.current).toBe('off');
});
