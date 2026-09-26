import { describe, expect, it } from 'vitest';
import { engineDisplayName } from './engineDisplayName';

describe('engineDisplayName', () => {
  it('uses the model name for legacy engine and resident labels', () => {
    expect(engineDisplayName('Sesly (k2-fsa/OmniVoice, 600+ languages)')).toBe(
      'OmniVoice (k2-fsa/OmniVoice, 600+ languages)',
    );
    expect(engineDisplayName('Sesly TTS')).toBe('OmniVoice TTS');
    expect(engineDisplayName('KittenTTS (English)')).toBe('KittenTTS (English)');
  });
});
