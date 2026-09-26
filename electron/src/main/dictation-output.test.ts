// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { DictationOutputClient } from './dictation-output';

function helper() {
  const process = Object.assign(new EventEmitter(), {
    pid: 43210,
    exitCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  mock.spawn.mockReturnValue(process);
  return process;
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('matches responses to requests without replaying native actions', async () => {
  const process = helper();
  const frames: { id: number; method: string }[] = [];
  process.stdin.on('data', (data) => frames.push(JSON.parse(data.toString())));
  const client = new DictationOutputClient('native-helper', 321);
  const first = client.request({ method: 'ping' });
  const second = client.request({ method: 'activate', session: 8 });
  process.stdout.write(JSON.stringify({ id: frames[1].id, result: null }) + '\n');
  process.stdout.write(JSON.stringify({ id: frames[0].id, result: { protocol: 1 } }) + '\n');
  expect(await first).toEqual({ protocol: 1 });
  expect(await second).toBe(null);
  expect(mock.spawn.mock.calls[0][1]).toEqual(['321']);
  process.emit('exit', 0);
  await expect(client.request({ method: 'ping' })).rejects.toThrow('closed');
  expect(mock.spawn).toHaveBeenCalledTimes(1);
});

it('terminates a timed-out helper so an uncertain delivery is never replayed', async () => {
  vi.useFakeTimers();
  vi.spyOn(process, 'kill').mockReturnValue(true);
  const native = helper();
  const client = new DictationOutputClient('native-helper');
  const pending = expect(
    client.request({ method: 'deliver', session: 9, text: 'hello' }),
  ).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await pending;
  expect(native.kill.mock.calls.length + vi.mocked(process.kill).mock.calls.length).toBe(1);
  await expect(client.request({ method: 'deliver', session: 9, text: 'hello' })).rejects.toThrow(
    'closed',
  );
  expect(mock.spawn).toHaveBeenCalledTimes(1);
});

it('rejects an outstanding call when the helper exits', async () => {
  const native = helper();
  const client = new DictationOutputClient('native-helper');
  const pending = expect(client.request({ method: 'ping' })).rejects.toThrow('exited');
  native.emit('exit', 1);
  await pending;
});

it('contains helper stream errors and rejects pending output', async () => {
  const native = helper();
  const client = new DictationOutputClient('native-helper');
  const pending = expect(client.request({ method: 'ping' })).rejects.toThrow('stream failed');

  expect(() => native.stderr.emit('error', new Error('stream failed'))).not.toThrow();
  await pending;
});

it('receives native press and release without consuming an RPC acknowledgement', async () => {
  const native = helper();
  const event = vi.fn();
  const client = new DictationOutputClient('native-helper', 321, event);
  const frames: { id: number }[] = [];
  native.stdin.on('data', (data) => frames.push(JSON.parse(data.toString())));
  const pending = client.request({ method: 'set_shortcut', accelerator: 'Ctrl+Alt+F24' });
  native.stdout.write(JSON.stringify({ event: 'shortcut', session: 7, pressed: true }) + '\n');
  native.stdout.write(JSON.stringify({ event: 'shortcut', session: 7, pressed: false }) + '\n');
  native.stdout.write(JSON.stringify({ id: frames[0].id, result: null }) + '\n');
  await pending;
  expect(event.mock.calls).toEqual([
    [{ session: 7, pressed: true }],
    [{ session: 7, pressed: false }],
  ]);
  native.emit('exit', 0);
});

it('allows streamed watch uploads to exceed the short interactive request timeout', async () => {
  vi.useFakeTimers();
  const native = helper();
  const client = new DictationOutputClient('native-helper');
  let id = 0;
  native.stdin.on('data', (data) => {
    id = JSON.parse(data.toString()).id;
  });
  const pending = client.request({
    method: 'watch_enqueue',
    backend_url: 'http://127.0.0.1:3900',
    authorization: null,
    token: 'selected',
    name: 'large.mp4',
    expected_size: 1_000_000,
    expected_mtime: 1,
    langs: ['es'],
    voice_id: null,
    preserve_bg: true,
  });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(native.kill).not.toHaveBeenCalled();
  native.stdout.write(JSON.stringify({ id, result: { status: 200 } }) + '\n');
  expect(await pending).toEqual({ status: 200 });
  native.emit('exit', 0);
});
