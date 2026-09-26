import { expect, it } from 'vitest';
import { blankLongformDraft, renderBody } from './longform-session';
import { storyVoicesReady } from './story-inputs';
it('resolves character inheritance, line overrides and speed through the shared compiler', () => {
  const draft = {
    ...blankLongformDraft(),
    cast: [{ id: 'mara', name: 'Mara', profileId: 'actor' }],
    globalSpeed: 1.2,
    lines: [
      { id: '1', text: 'Inherited', profileId: null, character: 'mara' },
      { id: '2', text: 'Override', profileId: 'narrator', character: 'mara', speed: 0.8 },
    ],
  };
  expect(storyVoicesReady(draft, [{ id: 'actor' }, { id: 'narrator' }])).toBe(true);
  expect(renderBody('stories', draft)).toMatchObject({
    chapters: [
      {
        spans: [
          { voice_id: 'actor', speed: 1.2 },
          { voice_id: 'narrator', speed: 0.8 },
        ],
      },
    ],
  });
  expect(storyVoicesReady({ ...draft, voice: 'narrator' }, [{ id: 'narrator' }])).toBe(false);
});
