import { expect, it } from 'vitest';
import { saveFiltersFor } from './save-filters';

it('keeps subtitle, package, video and audio downloads in their encoded format', () => {
  for (const extension of ['mp4', 'wav', 'mp3', 'm4b', 'srt', 'vtt', 'ass', 'zip']) {
    expect(saveFiltersFor(`output.${extension}`)).toEqual([
      { name: extension.toUpperCase(), extensions: [extension] },
      { name: 'All files', extensions: ['*'] },
    ]);
  }
  expect(saveFiltersFor('output')).toEqual([{ name: 'All files', extensions: ['*'] }]);
});
