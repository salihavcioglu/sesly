import { expect, it } from 'vitest';
import { dubExportRequest, type DubExportOptions } from './dub-export';
const options: DubExportOptions = {
  jobId: 'job',
  format: 'mp4',
  track: 'fr',
  tracks: ['original', 'fr'],
  preserveBg: true,
  burn: true,
  dual: true,
  karaoke: true,
  bitrate: '320',
};
it('exports only chosen video tracks with the chosen default and compatible subtitles', () => {
  const result = dubExportRequest(options);
  const url = new URL(result.path, 'http://localhost');
  expect(url.pathname).toBe('/dub/download/job');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    include_tracks: 'original,fr',
    default_track: 'fr',
    preserve_bg: 'true',
    burn_subs: 'true',
    dual: 'true',
    karaoke: 'false',
  });
  expect(() => dubExportRequest({ ...options, tracks: [] })).toThrow();
  expect(() => dubExportRequest({ ...options, tracks: ['original'] })).toThrow();
});
it('targets the selected language for audio, sidecars and production packages', () => {
  for (const [format, endpoint, extension] of [
    ['mp3', 'download-mp3', 'mp3'],
    ['wav', 'download-audio', 'wav'],
    ['srt', 'srt', 'srt'],
    ['vtt', 'vtt', 'vtt'],
    ['ass', 'ass', 'ass'],
    ['stems', 'export-stems', 'zip'],
    ['clips', 'export-segments', 'zip'],
  ] as const) {
    const result = dubExportRequest({ ...options, format, preserveBg: false });
    const url = new URL(result.path, 'http://localhost');
    expect(url.pathname).toBe(`/dub/${endpoint}/job`);
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(result.name.endsWith('.' + extension)).toBe(true);
    if (format === 'mp3') expect(url.searchParams.get('bitrate')).toBe('320k');
    if (format === 'wav' || format === 'mp3')
      expect(url.searchParams.get('preserve_bg')).toBe('false');
    if (format === 'srt' || format === 'vtt') expect(url.searchParams.get('dual')).toBe('true');
  }
});
