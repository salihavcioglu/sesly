// Contact channels — render-level coverage for every guidance section
// (bug / feature / community / security), each channel pointing at
// the right URL, and the in-app bug-report affordance.
//
// Contact is a SECTION of SupportPage now, not a page of its own: commercial
// licensing and getting in touch answered one question between them and each
// used to be somewhere else. What is pinned here is the content and its
// links — the page shell (header, back button) belongs to the host and is
// covered by SupportPage's own suite. openExternal is mocked so no real
// browser navigation happens; the store is the real one.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../api/external', () => ({ openExternal }));

import { ContactSections } from '../pages/ContactPage';
import { useAppStore } from '../store';

const REPO = 'https://github.com/salihavcioglu/sesly';

beforeEach(() => {
  openExternal.mockClear();
  useAppStore.getState().setMode?.('launchpad');
});

describe('contact sections', () => {
  it('renders every guidance section', () => {
    render(<ContactSections />);
    for (const name of [
      'Report a bug',
      'Request a feature or ask',
      'Get help & community',
      'Report a security issue',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('exposes the in-app bug-report affordance', () => {
    render(<ContactSections />);
    expect(screen.getByRole('button', { name: /open bug reporter/i })).toBeInTheDocument();
  });

  it('points each external channel at the right URL', () => {
    render(<ContactSections />);
    const href = (name) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Open GitHub Issues')).toBe(`${REPO}/issues`);
    expect(href('Open GitHub Discussions')).toBe(`${REPO}/discussions`);
    expect(href('Follow on X')).toBe('https://x.com/isalihavcioglu');
    expect(href('Report privately')).toBe(`${REPO}/security/advisories/new`);
    expect(href(/licensing/i)).toBe(`mailto:s.avcioglu23@gmail.com`);
    expect(href(/more about the project/i)).toBe('https://salihavcioglu.dev');
  });

  it('opens external links via the shared opener and marks them noreferrer', () => {
    render(<ContactSections />);
    const link = screen.getByRole('link', { name: 'Open GitHub Discussions' });
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(`${REPO}/discussions`);
  });
});
