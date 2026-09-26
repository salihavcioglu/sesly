// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { isTrustedRenderer } from './trusted-renderer';
const run = vi.hoisted(() => ({ output: 'ffmpeg version 8.0' }));
vi.mock('node:child_process', () => ({
  execFile: (
    _path: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, result: { stdout: string; stderr: string }) => void,
  ) => callback(null, { stdout: run.output, stderr: '' }),
}));
import { authorizeMediaTool } from './media-authorization';
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
it('compares full origins rather than URL prefixes', () => {
  expect(isTrustedRenderer('app://sesly/index.html')).toBe(true);
  expect(isTrustedRenderer('http://localhost:3902/settings', 'http://localhost:3902')).toBe(true);
  for (const url of [
    'app://sesly.evil/index.html',
    'http://localhost:39020',
    'http://localhost:3902.evil',
    'https://localhost:3902',
    'http://evil@localhost:3902',
  ]) {
    expect(isTrustedRenderer(url, 'http://localhost:3902')).toBe(false);
  }
});
it('writes the backend capability format only for a matching executable', async () => {
  directory = await mkdtemp(join(tmpdir(), 'vs-authorization-'));
  const executable = join(directory, 'media-tool');
  await writeFile(executable, 'test executable');
  run.output = 'ffmpeg version 8.0';
  await expect(authorizeMediaTool(directory, executable, 'ffprobe')).rejects.toThrow(
    'does not match',
  );
  expect(await readdir(directory)).toEqual(['media-tool']);
  const result = await authorizeMediaTool(directory, executable, 'ffmpeg');
  expect(result.authorization).toMatch(/^[a-f0-9]{64}$/);
  expect(
    JSON.parse(
      await readFile(
        join(directory, '.path-authorizations', result.authorization + '.json'),
        'utf8',
      ),
    ),
  ).toEqual({ token: result.authorization, kind: 'ffmpeg', path: result.path });
  await expect(authorizeMediaTool('relative', executable, 'ffmpeg')).rejects.toThrow('absolute');
});
