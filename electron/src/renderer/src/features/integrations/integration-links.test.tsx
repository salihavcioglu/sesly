import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import '@/i18n';
import { IntegrationsPage } from './integrations-page';
import { IntegrationDetailPage } from './integration-detail-page';

const navigate = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ slug: 'twilio' }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => route,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/hooks/use-backend-status', () => ({
  useBackendStatus: () => ({ baseUrl: 'http://127.0.0.1:3912' }),
}));
const bridge = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { openExternal: bridge.openExternal } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens every catalog logo in-app, never the vendor website', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { container } = render(<IntegrationsPage />);
  expect(container.querySelector('.lucide-external-link')).toBeNull();
  fireEvent.click(screen.getByRole('heading', { name: 'Twilio' }).closest('button')!);
  await waitFor(() =>
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/integrations/$slug',
      params: { slug: 'twilio' },
    }),
  );
  expect(bridge.openExternal).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it('gives a catalog entry its own page, with the website only on its Website card', () => {
  render(<IntegrationDetailPage />);
  expect(screen.getByRole('heading', { name: 'Twilio', level: 2 })).toBeInTheDocument();
  expect(bridge.openExternal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(bridge.openExternal).toHaveBeenCalledWith('https://www.twilio.com');
});
