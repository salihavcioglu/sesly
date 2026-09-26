import { beforeEach, expect, it } from 'vitest';
import { blankLongformDraft, longformSession } from '@/features/longform/longform-session';
import { placeLongformVoice } from './place-voice';
beforeEach(() =>
  longformSession.setState((state) => ({
    ...state,
    active: null,
    drafts: { stories: blankLongformDraft(), audiobook: blankLongformDraft() },
  })),
);
it('adds a story voice once and retains existing lines and casting', () => {
  const draft = {
    ...blankLongformDraft(),
    script: 'Existing script',
    cast: [{ id: 'old', name: 'Narrator', profileId: 'old-voice' }],
    lines: [{ id: 'line', text: 'Hello', profileId: 'old-voice' }],
  };
  longformSession.setState((state) => ({ ...state, drafts: { ...state.drafts, stories: draft } }));
  placeLongformVoice({ id: 'new', name: 'Guest' }, 'stories');
  placeLongformVoice({ id: 'new', name: 'Guest' }, 'stories');
  const result = longformSession.state.drafts.stories;
  expect(result.cast).toHaveLength(2);
  expect(result.cast[0]).toEqual(draft.cast[0]);
  expect(result.cast[1]).toMatchObject({ profileId: 'new', name: 'Guest' });
  expect(result.lines).toEqual(draft.lines);
  expect(result.script).toBe(draft.script);
});
it('changes only the audiobook default voice', () => {
  const draft = {
    ...blankLongformDraft(),
    script: 'Chapter 1',
    title: 'My book',
    voiceCast: { Guest: 'other' },
  };
  longformSession.setState((state) => ({
    ...state,
    drafts: { ...state.drafts, audiobook: draft },
  }));
  placeLongformVoice({ id: 'new', name: 'Narrator' }, 'audiobook');
  expect(longformSession.state.drafts.audiobook).toEqual({ ...draft, voice: 'new' });
});
it('refuses to alter either draft during production', () => {
  longformSession.setState((state) => ({ ...state, active: 'stories' }));
  expect(() => placeLongformVoice({ id: 'new', name: 'Guest' }, 'audiobook')).toThrow('Production');
  expect(longformSession.state.drafts.audiobook.voice).toBeNull();
});
