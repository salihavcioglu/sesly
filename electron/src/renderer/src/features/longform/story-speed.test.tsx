import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { blankLongformDraft, renderBody } from './longform-session';
import { StorySpeed, linesWithOwnSpeed } from './story-speed';

const draft = {
  ...blankLongformDraft(),
  globalSpeed: 0.95,
  lines: [
    { id: 'a', text: '# One', profileId: null },
    { id: 'b', text: 'Body.', profileId: null, speed: 0.8 },
    { id: 'c', text: 'More.', profileId: null, speed: null },
  ],
};

it('counts only lines that carry their own speed', () => {
  expect(linesWithOwnSpeed(draft.lines)).toBe(1);
  expect(linesWithOwnSpeed([])).toBe(0);
});

it('sets the book-wide speed from the setup card', () => {
  const onChange = vi.fn();
  render(<StorySpeed draft={draft} disabled={false} onChange={onChange} />);
  expect(screen.getByText('0.95×')).toBeVisible();
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '0.9' } });
  expect(onChange).toHaveBeenCalledWith({ globalSpeed: 0.9 });
});

it('hands overriding lines back to the book-wide speed in one click', () => {
  const onChange = vi.fn();
  render(<StorySpeed draft={draft} disabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use for all lines' }));
  const patch = onChange.mock.calls[0][0];
  expect(patch.lines.map((line: { speed?: number | null }) => line.speed)).toEqual([
    null,
    null,
    null,
  ]);
  expect(patch.lines.map((line: { text: string }) => line.text)).toEqual([
    '# One',
    'Body.',
    'More.',
  ]);
});

it('shows no override row when every line follows the book', () => {
  render(
    <StorySpeed
      draft={{ ...draft, lines: draft.lines.map((line) => ({ ...line, speed: null })) }}
      disabled={false}
      onChange={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Use for all lines' })).toBeNull();
});

it('applies the global speed to render requests without changing the cast or line voices', () => {
  const onChange = vi.fn();
  const story = {
    ...draft,
    cast: [{ id: 'actor', name: 'Actor', profileId: 'cast-voice' }],
    lines: [
      { id: 'one', text: 'First.', profileId: null, character: 'actor', speed: 1 },
      { id: 'two', text: 'Second.', profileId: 'line-voice', speed: 0.8 },
    ],
  };
  expect(linesWithOwnSpeed(story.lines)).toBe(2);
  render(<StorySpeed draft={story} disabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use for all lines' }));
  const updated = { ...story, ...onChange.mock.calls[0][0] };
  expect(updated.lines).toEqual(story.lines.map((line) => ({ ...line, speed: null })));
  expect(renderBody('stories', updated)).toMatchObject({
    chapters: [
      {
        spans: [
          { text: 'First.', voice_id: 'cast-voice', speed: 0.95 },
          { text: 'Second.', voice_id: 'line-voice', speed: 0.95 },
        ],
      },
    ],
  });
});

it('locks both speed controls during rendering', () => {
  const onChange = vi.fn();
  render(<StorySpeed draft={draft} disabled onChange={onChange} />);
  expect(screen.getByRole('slider', { name: 'Speed' })).toBeDisabled();
  const reset = screen.getByRole('button', { name: 'Use for all lines' });
  expect(reset).toBeDisabled();
  fireEvent.click(reset);
  expect(onChange).not.toHaveBeenCalled();
});
