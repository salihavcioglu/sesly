import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mock.navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { WorkspaceFooter } from './workspace-footer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows Integrations', () => {
  render(<WorkspaceFooter />);
  const buttons = screen.getByRole('contentinfo').querySelectorAll('button');
  expect(Array.from(buttons, (button) => button.textContent)).toEqual([
    'integrationCatalog.title',
  ]);
});

it('opens Integrations from the first button', () => {
  render(<WorkspaceFooter />);
  fireEvent.click(screen.getByRole('button', { name: 'integrationCatalog.title' }));
  expect(mock.navigate).toHaveBeenCalledWith({ to: '/integrations' });
});
