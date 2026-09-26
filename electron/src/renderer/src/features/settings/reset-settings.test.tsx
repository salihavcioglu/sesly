import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  clearDubDraft: vi.fn(),
  clearLongformDraft: vi.fn(),
  clearProjects: vi.fn(),
  getConnection: vi.fn(),
  purgeReset: vi.fn(),
  reload: vi.fn(),
  scanReset: vi.fn(),
}));

const bridge = {
  backend: { getConnection: mock.getConnection },
  maintenance: { purgeReset: mock.purgeReset, scanReset: mock.scanReset },
};

vi.mock('@/components/bridge', () => ({ getBridge: () => bridge }));
vi.mock('@/lib/api/client', async (load) => {
  const actual = await load<typeof import('@/lib/api/client')>();
  return { ...actual, apiFetch: mock.apiFetch };
});
vi.mock('@/features/longform/project-library', () => ({
  projectLibrary: { clear: mock.clearProjects },
}));
vi.mock('@/features/longform/longform-session', () => ({
  clearLongformDraftForReset: mock.clearLongformDraft,
}));
vi.mock('@/features/dub/dub-session', () => ({
  clearDubDraftForReset: mock.clearDubDraft,
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'settings.reset_confirm_word' ? 'DELETE' : key),
  }),
}));

import { LOCAL_SETTING_KEYS, ResetSettings, UI_PREFERENCE_KEYS } from './reset-settings';

const scopes = [
  { key: 'ui_prefs', size_bytes: 0, exists: true, shared: false, needs_restart: false },
  { key: 'history', size_bytes: 0, exists: true, shared: false, needs_restart: false },
  { key: 'settings', size_bytes: 100, exists: true, shared: false, needs_restart: true },
  { key: 'content', size_bytes: 200, exists: true, shared: false, needs_restart: true },
  { key: 'engines', size_bytes: 300, exists: true, shared: false, needs_restart: true },
  { key: 'tools', size_bytes: 400, exists: true, shared: false, needs_restart: true },
  { key: 'models', size_bytes: 500, exists: true, shared: true, needs_restart: true },
  { key: 'caches', size_bytes: 600, exists: true, shared: false, needs_restart: true },
  { key: 'logs', size_bytes: 700, exists: true, shared: false, needs_restart: true },
];

beforeEach(() => {
  localStorage.clear();
  mock.getConnection.mockResolvedValue({ remote: false });
  mock.scanReset.mockResolvedValue(scopes);
  mock.purgeReset.mockResolvedValue({
    removed: [],
    failed: [],
    refused: [],
    freed_bytes: 2800,
    restarted: true,
  });
  mock.apiFetch.mockResolvedValue(new Response(null, { status: 204 }));
  mock.clearProjects.mockResolvedValue(undefined);
  mock.clearLongformDraft.mockImplementation(() =>
    localStorage.removeItem('sesly.longform.v1'),
  );
  mock.clearDubDraft.mockImplementation(() =>
    localStorage.removeItem('sesly.dub.session.v1'),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('resets every renderer preference while preserving app settings and content', async () => {
  for (const key of UI_PREFERENCE_KEYS) localStorage.setItem(key, 'custom');
  for (const key of LOCAL_SETTING_KEYS) localStorage.setItem(key, 'custom');
  localStorage.setItem('sesly.design.v1', 'draft');
  localStorage.setItem('omni_transcriptions', 'history');

  render(<ResetSettings reload={mock.reload} />);
  await waitFor(() => expect(mock.scanReset).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'settings.reset' }));
  fireEvent.click(screen.getByRole('button', { name: 'settings.reset_confirm' }));

  await waitFor(() => expect(mock.reload).toHaveBeenCalledOnce());
  for (const key of UI_PREFERENCE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  for (const key of LOCAL_SETTING_KEYS) expect(localStorage.getItem(key)).toBe('custom');
  expect(localStorage.getItem('sesly.design.v1')).toBe('draft');
  expect(localStorage.getItem('omni_transcriptions')).toBe('history');
  expect(mock.purgeReset).not.toHaveBeenCalled();
});

it('shows scanned sizes and requires DELETE before removing all app content', async () => {
  for (const key of [
    ...UI_PREFERENCE_KEYS,
    ...LOCAL_SETTING_KEYS,
    'sesly.design.v1',
    'sesly.dub.session.v1',
    'sesly.longform.v1',
    'omni_transcriptions',
  ])
    localStorage.setItem(key, 'kept-until-confirmed');

  render(<ResetSettings reload={mock.reload} />);
  await waitFor(() => expect(mock.scanReset).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText('settings.reset_tier_everything'));
  fireEvent.click(screen.getByRole('button', { name: 'settings.reset' }));

  const confirm = screen.getByRole('button', { name: 'settings.reset_confirm_restart' });
  expect(confirm).toBeDisabled();
  expect(screen.getByText('settings.reset_models_shared_warning')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);

  await waitFor(() =>
    expect(mock.purgeReset).toHaveBeenCalledWith([
      'settings',
      'content',
      'engines',
      'tools',
      'models',
      'caches',
      'logs',
    ]),
  );
  expect(mock.clearProjects).toHaveBeenCalledOnce();
  expect(mock.clearLongformDraft).toHaveBeenCalledOnce();
  expect(mock.clearDubDraft).toHaveBeenCalledOnce();
  expect(mock.apiFetch).not.toHaveBeenCalled();
  await waitFor(() => expect(mock.reload).toHaveBeenCalledOnce());
  for (const key of [
    ...UI_PREFERENCE_KEYS,
    ...LOCAL_SETTING_KEYS,
    'sesly.design.v1',
    'sesly.dub.session.v1',
    'sesly.longform.v1',
    'omni_transcriptions',
  ])
    expect(localStorage.getItem(key)).toBeNull();
});

it('clears generation histories while preserving content and avoiding a backend restart', async () => {
  localStorage.setItem('omni_transcriptions', 'history');
  localStorage.setItem('sesly.design.v1', 'draft');
  render(<ResetSettings reload={mock.reload} />);
  await waitFor(() => expect(mock.scanReset).toHaveBeenCalledOnce());

  fireEvent.click(screen.getByRole('button', { name: 'settings.reset_advanced' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'settings.reset_scope_ui_prefs' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'settings.reset_scope_history' }));
  fireEvent.click(screen.getByRole('button', { name: 'settings.reset' }));
  fireEvent.click(screen.getByRole('button', { name: 'settings.reset_confirm' }));

  await waitFor(() => expect(mock.apiFetch).toHaveBeenCalledTimes(2));
  expect(mock.apiFetch).toHaveBeenCalledWith('/history', { method: 'DELETE' });
  expect(mock.apiFetch).toHaveBeenCalledWith('/dub/history', { method: 'DELETE' });
  expect(mock.purgeReset).not.toHaveBeenCalled();
  expect(mock.clearProjects).not.toHaveBeenCalled();
  expect(localStorage.getItem('omni_transcriptions')).toBeNull();
  expect(localStorage.getItem('sesly.design.v1')).toBe('draft');
  await waitFor(() => expect(mock.reload).toHaveBeenCalledOnce());
});
