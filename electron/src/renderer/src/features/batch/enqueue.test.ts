import { expect, it, vi } from 'vitest';
import { apiJson } from '@/lib/api/client';
import { enqueueVideos } from './enqueue';
vi.mock('@/lib/api/client', () => ({ apiJson: vi.fn() }));
it('retains only failed files and sends the selected languages and voice', async () => {
  const files = ['one', 'two', 'three'].map((name) => new File(['video'], name + '.mp4'));
  vi.mocked(apiJson)
    .mockResolvedValueOnce({ job_id: 'one' })
    .mockRejectedValueOnce(new Error('fixture'))
    .mockResolvedValueOnce({ job_id: 'three' });
  expect(await enqueueVideos(files, ['es', 'fr'], 'voice-id', false)).toEqual([files[1]]);
  const body = vi.mocked(apiJson).mock.calls[0][1]!.body as FormData;
  expect(body.get('langs')).toBe('es,fr');
  expect(body.get('voice_id')).toBe('voice-id');
  expect(body.get('preserve_bg')).toBe('false');
  expect(apiJson).toHaveBeenCalledTimes(3);
});
