import { describe, expect, it, vi } from 'vitest';
import { allowsRendererPermission, installRendererPermissions } from './media-permissions';

describe('renderer permissions', () => {
  it('grants trusted audio and denies camera or foreign origins', () => {
    expect(allowsRendererPermission('media', 'app://sesly/#/capture', ['audio'])).toBe(
      true,
    );
    expect(allowsRendererPermission('media', 'app://sesly/#/capture', ['video'])).toBe(
      false,
    );
    expect(allowsRendererPermission('media', 'https://example.com', ['audio'])).toBe(false);
    expect(
      allowsRendererPermission('media', 'app://sesly/frame.html', ['audio'], undefined, false),
    ).toBe(false);
    expect(
      allowsRendererPermission('media', 'http://localhost:3902/#/capture', ['audio'], 'http://localhost:3902'),
    ).toBe(true);
  });

  it('allows only the trusted browser permissions used by the renderer', () => {
    expect(allowsRendererPermission('clipboard-read', 'app://sesly/index.html', undefined)).toBe(
      true,
    );
    expect(allowsRendererPermission('fullscreen', 'app://sesly/index.html', undefined)).toBe(
      true,
    );
    expect(allowsRendererPermission('notifications', 'app://sesly/index.html', undefined)).toBe(
      false,
    );
  });

  it('installs matching check and request handlers', () => {
    let check: (...args: any[]) => boolean = () => false;
    let request: (...args: any[]) => void = () => {};
    const fakeSession = {
      setPermissionCheckHandler: vi.fn((handler) => {
        check = handler;
      }),
      setPermissionRequestHandler: vi.fn((handler) => {
        request = handler;
      }),
    };
    installRendererPermissions(fakeSession as never);

    expect(
      check(null, 'media', 'app://sesly', {
        isMainFrame: true,
        requestingUrl: 'app://sesly/#/capture',
        mediaType: 'audio',
      }),
    ).toBe(true);
    const callback = vi.fn();
    request(
      { getURL: () => 'app://sesly/#/capture' },
      'media',
      callback,
      { isMainFrame: true, requestingUrl: 'app://sesly/#/capture', mediaTypes: ['video'] },
    );
    expect(callback).toHaveBeenCalledWith(false);
  });
});
