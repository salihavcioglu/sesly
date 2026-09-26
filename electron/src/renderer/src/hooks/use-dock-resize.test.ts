import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { beforeEach, expect, it } from 'vitest';
import { useDockResize } from './use-dock-resize';

const storageKey = 'test.dock-height';

beforeEach(() => localStorage.clear());

it('restores, adjusts, and resets the dock height', () => {
  localStorage.setItem(storageKey, '360');
  const { result } = renderHook(() => useDockResize({ storageKey, enabled: false }));

  expect(result.current.height).toBe(360);

  act(() => {
    result.current.separatorProps.onKeyDown?.({
      key: 'ArrowUp',
      preventDefault() {},
    } as ReactKeyboardEvent<HTMLDivElement>);
  });
  expect(result.current.height).toBe(384);
  expect(localStorage.getItem(storageKey)).toBe('384');

  act(() => {
    result.current.separatorProps.onDoubleClick?.({} as ReactMouseEvent<HTMLDivElement>);
  });
  expect(result.current.height).toBe(420);
  expect(localStorage.getItem(storageKey)).toBe('420');
});
