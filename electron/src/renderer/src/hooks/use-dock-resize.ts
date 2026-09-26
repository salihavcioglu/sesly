import { useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

export function useDockResize({
  storageKey,
  minimum = 256,
  initial = 420,
  maximum = 720,
  reserve = 220,
  enabled = true,
}: {
  storageKey: string;
  minimum?: number;
  initial?: number;
  maximum?: number;
  reserve?: number;
  enabled?: boolean;
}) {
  const host = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [limit, setLimit] = useState(maximum);
  const [preferred, setPreferred] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return Number.isFinite(stored) && stored >= minimum ? stored : initial;
    } catch {
      return initial;
    }
  });
  const height = Math.max(minimum, Math.min(preferred, limit));

  useLayoutEffect(() => {
    if (!enabled) return;
    let parent = host.current?.parentElement ?? null;
    while (
      parent &&
      (parent.clientHeight === 0 || window.getComputedStyle(parent).display === 'contents')
    )
      parent = parent.parentElement;
    if (!parent) return;
    const measure = () =>
      setLimit(Math.max(minimum, Math.min(maximum, parent.clientHeight - reserve)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [enabled, maximum, minimum, reserve]);

  const resize = (value: number) => {
    const next = Math.max(minimum, Math.min(value, limit));
    setPreferred(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      /* The current session still keeps the selected height. */
    }
  };

  const separatorProps: HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'horizontal',
    'aria-valuemin': minimum,
    'aria-valuemax': limit,
    'aria-valuenow': height,
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { y: event.clientY, height };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
    },
    onPointerUp: (event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onDoubleClick: () => resize(initial),
    onKeyDown: (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      resize(height + (event.key === 'ArrowUp' ? 24 : -24));
    },
  };

  return { host, height, separatorProps };
}
