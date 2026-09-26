import { expect, it } from 'vitest';
import { blankLongformDraft, type Draft } from './longform-session';
import { clearedScriptPatch, scriptSize } from './story-clear';

// "Clear script" must drop every line and chapter of a story in one step but
// leave the cast alone; for an audiobook it empties the manuscript.

it('clears every story line and pending import text, never the cast', () => {
  const patch = clearedScriptPatch('stories');
  expect(patch).toEqual({ lines: [], importText: '' });
  expect('cast' in patch).toBe(false);
});

it('clears the audiobook manuscript', () => {
  expect(clearedScriptPatch('audiobook')).toEqual({ script: '' });
});

it('sizes the script so the button disables on an empty draft', () => {
  const draft = blankLongformDraft();
  expect(scriptSize('stories', draft)).toBe(0);
  expect(scriptSize('audiobook', draft)).toBe(0);
  draft.lines = [
    { id: '1', character: 'narrator', text: '# Chapter one', profileId: null },
    { id: '2', character: 'narrator', text: 'Zoe stepped closer.', profileId: null },
  ] as Draft['lines'];
  expect(scriptSize('stories', draft)).toBe(2);
  draft.importText = 'Imported but not yet split';
  expect(scriptSize('stories', draft)).toBe(3);
  draft.importText = '';
  draft.script = '  \n';
  expect(scriptSize('audiobook', draft)).toBe(0);
  draft.script = 'Once upon a time.';
  expect(scriptSize('audiobook', draft)).toBe(1);
});
