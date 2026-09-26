export const metadataFields = ['author', 'narrator', 'year', 'genre', 'description'] as const;
export interface BookOptions {
  metadata: Partial<Record<(typeof metadataFields)[number], string>>;
  loudness: 'off' | 'acx' | 'podcast';
  cover: { path: string; name: string } | null;
  lexicon: { word: string; pronunciation: string }[];
}
export function restoreBookOptions(value: Partial<BookOptions> | null | undefined): BookOptions {
  const metadata = Object.fromEntries(
    metadataFields.flatMap((key) =>
      typeof value?.metadata?.[key] === 'string' ? [[key, value.metadata[key]]] : [],
    ),
  );
  return {
    metadata,
    loudness: value?.loudness === 'acx' || value?.loudness === 'podcast' ? value.loudness : 'off',
    cover:
      typeof value?.cover?.path === 'string' && typeof value.cover.name === 'string'
        ? value.cover
        : null,
    lexicon: Array.isArray(value?.lexicon)
      ? value.lexicon.filter(
          (row) => row && typeof row.word === 'string' && typeof row.pronunciation === 'string',
        )
      : [],
  };
}
export function duplicateWords(rows: BookOptions['lexicon']): boolean {
  const keys = rows.map((row) => row.word.trim().toLowerCase()).filter(Boolean);
  return new Set(keys).size !== keys.length;
}
export function lexiconMap(rows: BookOptions['lexicon']) {
  if (duplicateWords(rows)) throw new Error('Duplicate pronunciation words');
  return Object.fromEntries(
    rows
      .filter((row) => row.word.trim() && row.pronunciation.trim())
      .map((row) => [row.word.trim(), row.pronunciation.trim()]),
  );
}
