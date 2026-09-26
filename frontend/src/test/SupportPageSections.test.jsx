// Commercial licensing and contact share one compact tabbed page. App.jsx
// renders SupportPage in the SAME tree position for both routes, so a
// changed `initialView` must update the active tab after mount too.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../api/external', () => ({ openExternal: vi.fn() }));

import SupportPage from '../pages/SupportPage';

beforeEach(() => {
  vi.clearAllMocks();
});

// Radix Tabs activate on pointer down; drive them like a real pointer.
const clickTab = (name) => {
  const tab = screen.getByRole('tab', { name });
  fireEvent.pointerDown(tab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
};

describe('the compact support page', () => {
  it('shows one destination at a time behind two tabs', () => {
    render(<SupportPage onBack={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Commercial License' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: 'Ship AI voices in production' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Report a bug' })).toBeNull();
  });

  it('updates the active tab when the reused route changes', () => {
    const { rerender } = render(<SupportPage onBack={() => {}} initialView="license" />);
    rerender(<SupportPage onBack={() => {}} initialView="contact" />);
    expect(screen.getByRole('tab', { name: 'Contact' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Report a bug' })).toBeInTheDocument();
  });

  it('switches destinations from the tab rail', () => {
    render(<SupportPage onBack={() => {}} />);
    clickTab('Contact');
    expect(screen.getByRole('heading', { name: 'Report a bug' })).toBeInTheDocument();
    clickTab('Commercial License');
    expect(
      screen.getByRole('heading', { name: 'Ship AI voices in production' }),
    ).toBeInTheDocument();
  });
});
