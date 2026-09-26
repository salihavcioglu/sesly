import { extname } from 'node:path';

/** Downloads are already encoded; the picker must not suggest another container. */
export function saveFiltersFor(name: string) {
  const extension = extname(name).slice(1).toLowerCase();
  const all = { name: 'All files', extensions: ['*'] };
  return /^[a-z0-9]{1,8}$/.test(extension)
    ? [{ name: extension.toUpperCase(), extensions: [extension] }, all]
    : [all];
}
