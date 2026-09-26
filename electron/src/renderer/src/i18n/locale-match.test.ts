import { expect, it } from 'vitest';
import { matchLocale } from './locale-match';

const supported = ['en', 'de', 'zh-CN', 'zh-TW'] as const;
it.each([
  ['zh-Hant', 'zh-TW'],
  ['zh-Hant-TW', 'zh-TW'],
  ['zh_Hant_HK', 'zh-TW'],
  ['zh-Hans-HK', 'zh-CN'],
  ['zh-HK', 'zh-TW'],
  ['zh-MO', 'zh-TW'],
  ['zh-SG', 'zh-CN'],
  ['zh-TW-u-nu-hanidec', 'zh-TW'],
  ['DE_ch', 'de'],
  ['en-US', 'en'],
  ['not_a_locale', null],
  ['es-ES', null],
] as const)('matches %s to %s', (input, expected) => {
  expect(matchLocale(input, supported)).toBe(expected);
});
