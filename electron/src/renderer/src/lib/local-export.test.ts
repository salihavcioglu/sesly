import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bridge: null as object | null, save: vi.fn() }));
vi.mock('@/components/bridge', () => ({ getBridge: () => mocks.bridge }));

import { saveLocalFile } from './local-export';

afterEach(() => {
  vi.clearAllMocks();
  mocks.bridge = null;
});

it('writes renderer-generated files through native Save As in Electron', async () => {
  mocks.bridge = { files: { saveData: mocks.save } };
  mocks.save.mockResolvedValue({ canceled: false, path: 'C:\\transcript.txt' });

  const result = await saveLocalFile(new Blob(['hello']), 'transcript.txt');

  expect(mocks.save).toHaveBeenCalledOnce();
  const request = mocks.save.mock.calls[0][0];
  expect(request.suggestedName).toBe('transcript.txt');
  expect(new TextDecoder().decode(request.data)).toBe('hello');
  expect(result.path).toBe('C:\\transcript.txt');
});
