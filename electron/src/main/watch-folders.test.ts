// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  pick: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: mocks.pick },
  ipcMain: {
    handle: (key: string, value: (...args: any[]) => any) => mocks.handlers.set(key, value),
    removeHandler: (key: string) => mocks.handlers.delete(key),
  },
}));
vi.mock('./backend', () => ({ backendRoot: () => '/repo' }));
vi.mock('./dictation-output', () => ({
  DictationOutputClient: class {
    request = mocks.request;
    close = mocks.close;
  },
}));
import { installWatchFolders } from './watch-folders';
function fixture(baseUrl = 'http://127.0.0.1:3900', headers: Record<string, string> = {}) {
  const frame = { url: 'app://sesly/index.html' };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame });
  const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  const close = installWatchFolders(
    () => window as never,
    () => baseUrl,
    () => headers,
  );
  mocks.pick.mockResolvedValue({ canceled: false, filePaths: ['/selected'] });
  mocks.request.mockResolvedValue({ token: 'capability', path: '/selected' });
  const call = (name: string, value?: unknown) =>
    mocks.handlers.get('watch:' + name)!(event, value);
  return { close, call, event, contents };
}
afterEach(() => {
  mocks.handlers.clear();
  vi.clearAllMocks();
});
it('only the owning main frame can pick or access a folder', async () => {
  const f = fixture();
  await expect(
    mocks.handlers.get('watch:pick')!({
      ...f.event,
      senderFrame: { url: f.event.senderFrame.url },
    }),
  ).rejects.toThrow('Untrusted');
  expect(mocks.pick).not.toHaveBeenCalled();
  await f.call('pick');
  await expect(f.call('scan', 'invented')).rejects.toThrow('not authorized');
  await f.call('scan', 'capability');
  expect(mocks.request).toHaveBeenLastCalledWith({ method: 'watch_scan', token: 'capability' });
  f.contents.emit('did-start-loading');
  expect(mocks.close).toHaveBeenCalledTimes(1);
  await expect(f.call('scan', 'capability')).rejects.toThrow('not authorized');
  f.close();
});
it('never registers a picker result after its renderer has closed', async () => {
  const f = fixture();
  let resolve!: (value: object) => void;
  mocks.pick.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const picking = f.call('pick');
  f.contents.emit('destroyed');
  resolve({ canceled: false, filePaths: ['/selected'] });
  expect(await picking).toBe(null);
  expect(mocks.request).not.toHaveBeenCalled();
  f.close();
});
it('supplies the trusted backend URL and scoped auth while rejecting malformed uploads', async () => {
  const f = fixture('https://gpu-box.example:3900', {
    Authorization: 'Bearer scoped-session',
  });
  await f.call('pick');
  const request = {
    token: 'capability',
    entry: { name: 'video.mp4', size: 20, mtime: 5 },
    langs: ['es'],
    voiceId: '',
    preserveBg: true,
  };
  await expect(f.call('enqueue', { ...request, langs: ['es,fr'] })).rejects.toThrow('Invalid');
  mocks.request.mockResolvedValueOnce({ status: 200 });
  await f.call('enqueue', request);
  expect(mocks.request).toHaveBeenLastCalledWith({
    method: 'watch_enqueue',
    backend_url: 'https://gpu-box.example:3900',
    authorization: 'Bearer scoped-session',
    token: 'capability',
    name: 'video.mp4',
    expected_size: 20,
    expected_mtime: 5,
    langs: ['es'],
    voice_id: null,
    preserve_bg: true,
  });
  f.call('stop', 'stale');
  expect(mocks.close).not.toHaveBeenCalled();
  f.call('stop', 'capability');
  expect(mocks.close).toHaveBeenCalledTimes(1);
  f.close();
});
