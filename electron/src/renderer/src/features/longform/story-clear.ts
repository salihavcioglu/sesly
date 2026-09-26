import type { Draft, Mode } from './longform-session';

/** What "Clear script" empties: every Stories line (cast kept) or the Audiobook manuscript. */
export function clearedScriptPatch(mode: Mode): Partial<Draft> {
  return mode === 'audiobook' ? { script: '' } : { lines: [], importText: '' };
}

/**
 * How much a clear would remove — drives the button's disabled state and the
 * confirm copy. For Stories the pending import buffer (text imported but not
 * yet split into lines) counts as one item, so it can be cleared too.
 */
export function scriptSize(mode: Mode, draft: Draft): number {
  if (mode === 'audiobook') return draft.script.trim() ? 1 : 0;
  return draft.lines.length + (draft.importText?.trim() ? 1 : 0);
}
