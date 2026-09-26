// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { sendToLiveWindow } from './window-safety';

function fixture(options: { windowDestroyed?: boolean; contentsDestroyed?: boolean } = {}) {
  const send = vi.fn();
  const restore = vi.fn();
  const show = vi.fn();
  const focus = vi.fn();
  const window = {
    isDestroyed: () => options.windowDestroyed === true,
    isMinimized: () => true,
    restore,
    show,
    focus,
    webContents: {
      isDestroyed: () => options.contentsDestroyed === true,
      send,
    },
  };
  return { focus, restore, send, show, window: window as never };
}

it('sends only while both the window and web contents are alive', () => {
  const live = fixture();
  expect(sendToLiveWindow(live.window, 'status', { ready: true })).toBe(true);
  expect(live.send).toHaveBeenCalledWith('status', { ready: true });

  const closed = fixture({ contentsDestroyed: true });
  expect(sendToLiveWindow(closed.window, 'status')).toBe(false);
  expect(closed.send).not.toHaveBeenCalled();
});

it('restores and focuses a live window while ignoring a close race', async () => {
  const { activateLiveWindow } = await import('./window-safety');
  const live = fixture();
  expect(activateLiveWindow(live.window)).toBe(true);
  expect(live.restore).toHaveBeenCalledOnce();
  expect(live.show).toHaveBeenCalledOnce();
  expect(live.focus).toHaveBeenCalledOnce();

  const closing = fixture();
  closing.show.mockImplementation(() => {
    throw new Error('Object has been destroyed');
  });
  expect(activateLiveWindow(closing.window)).toBe(false);
});

it('consumes a teardown race but preserves unrelated send failures', () => {
  const closing = fixture();
  closing.send.mockImplementation(() => {
    throw new Error('Object has been destroyed');
  });
  expect(sendToLiveWindow(closing.window, 'status')).toBe(false);

  const broken = fixture();
  broken.send.mockImplementation(() => {
    throw new Error('Could not serialize payload');
  });
  expect(() => sendToLiveWindow(broken.window, 'status')).toThrow('serialize');
});
