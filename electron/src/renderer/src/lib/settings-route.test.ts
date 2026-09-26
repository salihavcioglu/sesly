import { beforeEach, expect, it } from 'vitest';
import {
  readLastSettingsRoute,
  rememberSettingsRoute,
  SETTINGS_ROUTE_STORAGE_KEY,
} from './settings-route';

beforeEach(() => localStorage.clear());

it('restores only real settings routes and defaults to Appearance', () => {
  expect(readLastSettingsRoute()).toBe('/settings/appearance');
  rememberSettingsRoute('/settings/models/diarisation');
  expect(readLastSettingsRoute()).toBe('/settings/models/diarisation');

  localStorage.setItem(SETTINGS_ROUTE_STORAGE_KEY, '/clone');
  expect(readLastSettingsRoute()).toBe('/settings/appearance');
});

it('ignores non-settings paths rather than replacing the last page', () => {
  rememberSettingsRoute('/settings/storage');
  rememberSettingsRoute('/projects');
  expect(readLastSettingsRoute()).toBe('/settings/storage');
});
