import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

// The main navigation sits directly under the sidebar header, above the voice
// library, so its position never depends on how tall the library is.

const route = vi.hoisted(() => ({ pathname: '/clone' }));
const sidebar = vi.hoisted(() => ({ compact: false, setOpen: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: any) => select({ location: route }),
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/store/workspace', () => ({
  useWorkspace: () => ({ libraryOpen: true, libraryTab: 'voices' }),
  setWorkspace: vi.fn(),
}));
vi.mock('@/components/bridge', () => ({ isMac: () => false }));
vi.mock('@/lib/brand', () => ({ brandIcon: 'icon.png', brandArtwork: 'art.png' }));
vi.mock('@/hooks/use-pane-resize', () => ({
  usePaneResize: () => ({ host: { current: null }, width: 280, separatorProps: {} }),
}));
vi.mock('@/hooks/use-backend-status', () => ({ useBackendStatus: () => ({ stage: 'ready' }) }));
vi.mock('@/features/clone/voices-sidebar', () => ({
  VoicesSidebar: () => <div data-testid="library" />,
}));
vi.mock('./workspace-menu', () => ({
  WorkspaceNavigation: () => <nav data-testid="navigation" />,
}));
vi.mock('./status-bar', () => ({ StatusBar: () => <div data-testid="status" /> }));
vi.mock('./system-notifications', () => ({ SystemNotifications: () => null }));
vi.mock('./use-workspace-sidebar', () => ({
  useWorkspaceSidebarState: () => ({
    compact: sidebar.compact,
    compactViewport: false,
    forceExpanded: false,
    secondaryWorkspace: false,
    setOpen: sidebar.setOpen,
  }),
}));
import { WorkspaceSidebar } from './workspace-sidebar';

beforeEach(() => {
  sidebar.compact = false;
  sidebar.setOpen.mockClear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

it('expands the compact rail on double-click without changing single-click navigation', () => {
  sidebar.compact = true;
  render(<WorkspaceSidebar />);
  const rail = screen.getByRole('complementary', { name: 'clone.saved_profiles' });
  fireEvent.click(rail);
  expect(sidebar.setOpen).not.toHaveBeenCalled();
  fireEvent.doubleClick(rail);
  expect(sidebar.setOpen).toHaveBeenCalledWith(true);
});

it('places the navigation above the voice library in the expanded sidebar', () => {
  render(<WorkspaceSidebar />);
  const navigation = screen.getByTestId('navigation');
  const library = screen.getByTestId('library');
  const status = screen.getByTestId('status');
  expect(
    navigation.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(library.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
