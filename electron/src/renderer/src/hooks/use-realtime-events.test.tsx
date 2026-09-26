import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { RealtimeEventSync } from './use-realtime-events';

const mocks = vi.hoisted(() => ({
  websocketUrl: vi.fn().mockResolvedValue('ws://127.0.0.1:3900/ws/events'),
  bridge: true,
  remote: true,
}));

vi.mock('@/components/bridge', () => ({
  getBridge: () => (mocks.bridge ? { backend: { websocketUrl: mocks.websocketUrl } } : null),
}));
vi.mock('@/hooks/use-backend-status', () => ({
  useBackendStatus: () => ({
    stage: 'ready',
    baseUrl: 'http://127.0.0.1:3900',
    remote: mocks.remote,
  }),
}));

class Socket {
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    Socket.instances.push(this);
  }

  close() {
    this.readyState = Socket.CLOSED;
  }
}

afterEach(() => {
  cleanup();
  Socket.instances = [];
  mocks.websocketUrl.mockClear();
  mocks.bridge = true;
  mocks.remote = true;
  vi.unstubAllGlobals();
});

it('waits for browser development health before opening the proxied event stream', async () => {
  mocks.bridge = false;
  mocks.remote = false;
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('WebSocket', Socket);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <RealtimeEventSync />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  expect(fetcher).toHaveBeenCalledWith(
    '/api/health',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(new URL(Socket.instances[0].url).pathname).toBe('/api/ws/events');
  expect(mocks.websocketUrl).not.toHaveBeenCalled();
});

it('invalidates only the cache surfaces named by real-time backend events', async () => {
  vi.stubGlobal('WebSocket', Socket);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of [
    ['profiles'],
    ['history'],
    ['projects'],
    ['dub-history'],
    ['export-history'],
    ['engines'],
    ['sidebar-model-status'],
  ]) {
    client.setQueryData(key, { fresh: true });
  }

  render(
    <QueryClientProvider client={client}>
      <RealtimeEventSync />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  expect(mocks.websocketUrl).toHaveBeenCalledWith('/ws/events');

  const socket = Socket.instances[0];
  act(() => socket.onmessage?.(new MessageEvent('message', { data: '{"kind":"profiles"}' })));
  expect(client.getQueryState(['profiles'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['history'])?.isInvalidated).toBe(false);

  act(() =>
    socket.onmessage?.(new MessageEvent('message', { data: '{"kind":"generation_history"}' })),
  );
  expect(client.getQueryState(['history'])?.isInvalidated).toBe(true);

  act(() => socket.onmessage?.(new MessageEvent('message', { data: '{"kind":"model_status"}' })));
  expect(client.getQueryState(['engines'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['sidebar-model-status'])?.isInvalidated).toBe(true);
});

it('ignores malformed and unknown frames and closes on unmount', async () => {
  vi.stubGlobal('WebSocket', Socket);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['profiles'], { fresh: true });
  const view = render(
    <QueryClientProvider client={client}>
      <RealtimeEventSync />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0];

  act(() => socket.onmessage?.(new MessageEvent('message', { data: 'private malformed data' })));
  act(() => socket.onmessage?.(new MessageEvent('message', { data: '{"kind":"unknown"}' })));
  expect(client.getQueryState(['profiles'])?.isInvalidated).toBe(false);

  view.unmount();
  expect(socket.readyState).toBe(Socket.CLOSED);
});
