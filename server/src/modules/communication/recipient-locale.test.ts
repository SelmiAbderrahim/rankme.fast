import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import {
  InvalidOutboundLocaleError,
  resolveRecipientLocale,
} from './recipient-locale.js';

describe('resolveRecipientLocale', () => {
  it.each(SUPPORTED_LOCALES)('accepts the deliberate artifact locale %s', (locale) => {
    expect(resolveRecipientLocale({
      artifactLocale: locale,
      requestLocale: locale === 'ar' ? 'de' : 'ar',
      recipientLocale: 'fr',
    })).toBe(locale);
  });

  it.each(SUPPORTED_LOCALES)('accepts the actor request locale %s', (locale) => {
    expect(resolveRecipientLocale({ requestLocale: locale, recipientLocale: 'ru' }))
      .toBe(locale);
  });

  it.each(SUPPORTED_LOCALES)('accepts the stored recipient locale %s', (locale) => {
    expect(resolveRecipientLocale({ recipientLocale: locale })).toBe(locale);
  });

  it('uses the validated deployment default only after a missing/corrupt preference', () => {
    expect(resolveRecipientLocale({ recipientLocale: 'unsupported' })).toBe(env.DEFAULT_LOCALE);
    expect(resolveRecipientLocale({})).toBe(env.DEFAULT_LOCALE);
  });

  it.each(['artifactLocale', 'requestLocale'] as const)(
    'fails closed for an invalid explicit %s',
    (field) => {
      expect(() => resolveRecipientLocale({ [field]: 'unsupported' }))
        .toThrow(InvalidOutboundLocaleError);
    },
  );
});
