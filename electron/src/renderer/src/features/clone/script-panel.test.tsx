import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { ScriptPanel } from './script-panel';

const setCloneSetting = vi.fn();

vi.mock('@/lib/languages', () => ({
  LANGUAGES: ['Auto'],
  POPULAR_LANGUAGES: [],
  TAGS: ['[laughter]', '[sigh]'],
}));

vi.mock('@/lib/store/clone-settings', () => ({
  useCloneSetting: () => 'hello world',
  setCloneSetting: (...args: unknown[]) => setCloneSetting(...args),
}));

describe('ScriptPanel', () => {
  it('inserts an expression token at the caret', () => {
    render(<ScriptPanel />);
    const textarea = screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(5, 5);

    fireEvent.click(screen.getByRole('button', { name: 'Insert expression token' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '[laughter]' }));

    expect(setCloneSetting).toHaveBeenCalledWith('text', 'hello[laughter] world');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not open or reopen the token menu when the script box is clicked', () => {
    render(<ScriptPanel />);
    const textarea = screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement;

    // A plain click to place the caret must not summon the menu.
    fireEvent.pointerDown(textarea);
    fireEvent.click(textarea);
    expect(screen.queryByRole('menu')).toBeNull();

    // After inserting a token, clicking back in to keep writing must not
    // bring the menu back (regression: onClick reopened it on every caret
    // placement).
    fireEvent.click(screen.getByRole('button', { name: 'Insert expression token' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '[laughter]' }));
    fireEvent.pointerDown(textarea);
    fireEvent.click(textarea);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows the character count', () => {
    render(<ScriptPanel />);
    expect(screen.getByText('11 characters')).toBeInTheDocument();
  });

  it('closes the caret menu on window resize without treating Window as a DOM node', () => {
    render(<ScriptPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert expression token' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent(window, new Event('resize'));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
