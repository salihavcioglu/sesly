import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CLONE_SETTINGS } from './clone-settings';
import { rememberTake, takeSettings } from './takes';
import type { HistoryItem } from '@/lib/api/types';
const item = {
  id: 'take',
  text: 'original script',
  language: 'French',
  instruct: '',
  profile_id: 'voice',
} as HistoryItem;
beforeEach(() => localStorage.clear());
describe('take metadata', () => {
  it('restores original generation controls without overwriting application preferences', () => {
    rememberTake('take', { ...DEFAULT_CLONE_SETTINGS, speed: 1.5, steps: 24, autoPlay: false });
    expect(takeSettings(item)).toMatchObject({
      text: 'original script',
      speed: 1.5,
      steps: 24,
      selectedProfileId: 'voice',
      language: 'French',
    });
    expect(takeSettings(item)).not.toHaveProperty('autoPlay');
  });
  it('uses known history fields when metadata is malformed or absent', () => {
    localStorage.setItem('sesly.take-settings.v1', '{');
    expect(takeSettings(item)).toEqual({
      text: item.text,
      language: 'French',
      instruct: '',
      selectedProfileId: 'voice',
    });
  });
});
