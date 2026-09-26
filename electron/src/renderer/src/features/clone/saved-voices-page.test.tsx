import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/use-profiles', () => ({ useProfiles: () => ({ data: [] }) }));
vi.mock('@/lib/store/workspace', () => ({
  setWorkspace: vi.fn(),
  useWorkspace: () => ({ editingProfileId: null }),
}));
vi.mock('./voices-sidebar', () => ({ SavedVoices: () => <div>voice library</div> }));
vi.mock('./edit-profile', () => ({ EditProfile: () => null }));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

import { SavedVoicesPage } from './saved-voices-page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps saved profiles as the page content and exposes both creation paths', () => {
  render(<SavedVoicesPage />);
  expect(screen.getByText('voice library')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'clone.title' }));
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/clone' });

  fireEvent.click(screen.getByRole('button', { name: 'designWorkspace.title' }));
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/design' });
});
