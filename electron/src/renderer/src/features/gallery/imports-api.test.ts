import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/api/client', () => ({ apiJson: mocks.api }));
import { importsApi } from './imports-api';
it('uses the shared gallery multipart contract for files and portable bundles', async () => {
  const file = new File(['audio'], 'voice.sample.wav');
  await importsApi.upload(file);
  let [path, request] = mocks.api.mock.calls.at(-1)!;
  expect(path).toBe('/gallery/upload');
  expect(request.method).toBe('POST');
  expect(request.body.get('name')).toBe('voice.sample');
  expect(request.body.get('category')).toBe('import');
  expect(request.body.get('audio')).toBe(file);
  await importsApi.persona(file);
  [path, request] = mocks.api.mock.calls.at(-1)!;
  expect(path).toBe('/personas/import');
  expect(request.body.get('file')).toBe(file);
});
it('encodes URLs and profile names without changing query parameters', async () => {
  const options = {
    video_url: 'https://example.com/watch?a=1&b=2',
    character_name: 'A & B',
    start_time: 0,
    duration: 15,
    category: 'import',
    description: 'a?#b',
  };
  await importsApi.download(options);
  const url = new URL(mocks.api.mock.calls.at(-1)![0], 'http://localhost');
  expect(url.searchParams.get('video_url')).toBe(options.video_url);
  expect(url.searchParams.get('character_name')).toBe('A & B');
  expect(url.searchParams.get('description')).toBe('a?#b');
});
