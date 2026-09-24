import { describe, expect, it, beforeEach } from 'vitest';
import i18n from 'i18next';
import { initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import {
  apiErrorCode,
  apiErrorInfo,
  apiErrorLanguage,
  apiErrorMessage,
  apiErrorMessageKey,
  apiErrorRetryAfterMs,
  apiErrorStatus,
  parseApiErrorEnvelope,
  translateApiMessageKey,
} from './errorMessage';

beforeEach(async () => {
  await initI18n({ initialLocale: 'en' });
});

describe('parseApiErrorEnvelope', () => {
  it('normalizes the ordinary object envelope', () => {
    expect(
      parseApiErrorEnvelope({
        error: {
          message: 'The requested resource was not found.',
          code: 'NOT_FOUND',
          messageKey: 'errors.notFound',
          details: { field: 'siteId' },
        },
      }),
    ).toEqual({
      family: 'object',
      code: 'NOT_FOUND',
      messageKey: 'errors.notFound',
      message: 'The requested resource was not found.',
      details: { field: 'siteId' },
    });
  });

  it('normalizes the coded rate-limit envelope', () => {
    expect(
      parseApiErrorEnvelope({
        error: {
          code: 'PAGES_RATE_LIMITED',
          message: 'Too many page requests.',
          messageKey: 'pages.errors.rateLimited',
        },
      }),
    ).toMatchObject({
      code: 'PAGES_RATE_LIMITED',
      messageKey: 'pages.errors.rateLimited',
      message: 'Too many page requests.',
    });
  });

  it('normalizes the legacy string rate-limit envelope with its sibling metadata', () => {
    expect(
      parseApiErrorEnvelope({
        error: 'Too many requests. Try again later.',
        errorInfo: {
          code: 'SECURITY_ERROR_RATE_LIMITED',
          messageKey: 'security.error.rateLimited',
          message: 'Too many requests. Try again later.',
        },
      }),
    ).toEqual({
      family: 'legacy',
      code: 'SECURITY_ERROR_RATE_LIMITED',
      messageKey: 'security.error.rateLimited',
      message: 'Too many requests. Try again later.',
      details: undefined,
    });
  });

  it('reads the sibling message when the legacy string itself is unusable', () => {
    expect(
      parseApiErrorEnvelope({
        error: 'security.error.rateLimited',
        errorInfo: {
          code: 'SECURITY_ERROR_RATE_LIMITED',
          messageKey: 'security.error.rateLimited',
          message: 'Too many requests. Try again later.',
        },
      })?.message,
    ).toBe('Too many requests. Try again later.');
  });

  it('keeps a legacy string envelope usable with no sibling metadata at all', () => {
    expect(parseApiErrorEnvelope({ error: 'Too many requests.' })).toEqual({
      family: 'legacy',
      code: null,
      messageKey: null,
      message: 'Too many requests.',
      details: undefined,
    });
  });

  it('returns null for anything that is not a recognized envelope', () => {
    expect(parseApiErrorEnvelope(null)).toBeNull();
    expect(parseApiErrorEnvelope('<html>502 Bad Gateway</html>')).toBeNull();
    expect(parseApiErrorEnvelope(['error'])).toBeNull();
    expect(parseApiErrorEnvelope({ message: 'no error member' })).toBeNull();
    expect(parseApiErrorEnvelope({ error: 42 })).toBeNull();
  });

  it('refuses raw keys, placeholders, blanks, and oversized machine values', () => {
    expect(parseApiErrorEnvelope({ error: { message: 'errors.notFound' } })?.message).toBeNull();
    expect(
      parseApiErrorEnvelope({ error: { message: 'Your cap for {{metric}} is gone.' } })?.message,
    ).toBeNull();
    expect(parseApiErrorEnvelope({ error: { message: '   ' } })?.message).toBeNull();
    expect(parseApiErrorEnvelope({ error: { message: 12 } })?.message).toBeNull();
    expect(
      parseApiErrorEnvelope({ error: { message: 'ok', code: 'C'.repeat(200) } })?.code,
    ).toBeNull();
    expect(parseApiErrorEnvelope({ error: { message: 'ok', code: '' } })?.code).toBeNull();
    expect(parseApiErrorEnvelope({ error: { message: 'ok', messageKey: 9 } })?.messageKey).toBeNull();
  });
});

describe('apiErrorMessage', () => {
  it('returns the server-provided message when present', () => {
    const err = new ApiError('x', 400, { error: { message: 'server said no' } });
    expect(apiErrorMessage(err, 'backlinks:loadFailed')).toBe('server said no');
  });

  it('falls back to the localized string when message is empty', () => {
    const err = new ApiError('x', 400, { error: { message: '' } });
    expect(apiErrorMessage(err, 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('never renders a raw key, a placeholder, or the internal wrapper message', () => {
    expect(
      apiErrorMessage(
        new ApiError('Request to /api/sites failed with status 404', 404, {
          error: { message: 'errors.notFound', code: 'NOT_FOUND' },
        }),
        'backlinks:loadFailed',
      ),
    ).toBe(i18n.t('backlinks:loadFailed'));
    expect(
      apiErrorMessage(
        new ApiError('x', 409, { error: { message: 'Conflict on {{resource}}.' } }),
        'backlinks:loadFailed',
      ),
    ).toBe(i18n.t('backlinks:loadFailed'));
  });

  it('reads a legacy rate-limit envelope only when the server marked it', () => {
    const marked = new ApiError('x', 429, {
      error: 'Too many requests. Try again later.',
      errorInfo: {
        code: 'SECURITY_ERROR_RATE_LIMITED',
        messageKey: 'security.error.rateLimited',
        message: 'Too many requests. Try again later.',
      },
    });
    expect(apiErrorMessage(marked, 'backlinks:loadFailed')).toBe(
      'Too many requests. Try again later.',
    );
    // An unmarked string body may be an opaque token from an older producer.
    const unmarked = new ApiError('x', 500, { error: 'capReached' });
    expect(apiErrorMessage(unmarked, 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('falls back on a non-ApiError value', () => {
    expect(apiErrorMessage(new Error('boom'), 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
    expect(apiErrorMessage('nope', 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
    expect(apiErrorMessage(undefined, 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('falls back when the ApiError body lacks an error object', () => {
    const err = new ApiError('x', 400, undefined);
    expect(apiErrorMessage(err, 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('maps network and timeout ApiError codes to shared localized keys', () => {
    expect(
      apiErrorMessage(
        new ApiError('offline', 0, null, 'network'),
        'backlinks:loadFailed',
      ),
    ).toBe(i18n.t('errors:network'));
    expect(
      apiErrorMessage(
        new ApiError('slow', 0, null, 'timeout'),
        'backlinks:loadFailed',
      ),
    ).toBe(i18n.t('errors:timeout'));
  });
});

describe('apiErrorStatus', () => {
  it('returns the ApiError status', () => {
    expect(apiErrorStatus(new ApiError('x', 402, undefined))).toBe(402);
  });
  it('returns null on non-ApiError', () => {
    expect(apiErrorStatus(new Error('x'))).toBeNull();
    expect(apiErrorStatus('nope')).toBeNull();
  });
});

describe('code, key, and language helpers', () => {
  it('exposes the stable metadata a feature can branch on', () => {
    const err = new ApiError(
      'x',
      409,
      { error: { message: 'Site exists.', code: 'CONFLICT', messageKey: 'sites.errors.duplicate' } },
      'http',
      'de',
    );
    expect(apiErrorCode(err)).toBe('CONFLICT');
    expect(apiErrorMessageKey(err)).toBe('sites.errors.duplicate');
    expect(apiErrorLanguage(err)).toBe('de');
    expect(apiErrorInfo(err)?.message).toBe('Site exists.');
  });

  it('re-renders a stable server key from the active client locale', async () => {
    await i18n.changeLanguage('en');
    const english = translateApiMessageKey('errors.notFound');
    await i18n.changeLanguage('ar');
    const arabic = translateApiMessageKey('errors.notFound');

    expect(english).toBe('The requested resource was not found.');
    expect(arabic).not.toBe(english);
    expect(arabic).toBeTruthy();
    expect(translateApiMessageKey(null)).toBeNull();
    expect(translateApiMessageKey('invalid')).toBeNull();
    expect(translateApiMessageKey('unknown.missing')).toBeNull();
  });

  it('returns null for values that carry no envelope', () => {
    expect(apiErrorCode(new Error('x'))).toBeNull();
    expect(apiErrorMessageKey(new Error('x'))).toBeNull();
    expect(apiErrorLanguage(new Error('x'))).toBeNull();
    expect(apiErrorInfo(new Error('x'))).toBeNull();
    expect(apiErrorCode(new ApiError('x', 500, undefined))).toBeNull();
    expect(apiErrorMessageKey(new ApiError('x', 500, undefined))).toBeNull();
    expect(apiErrorLanguage(new ApiError('x', 500, undefined))).toBeNull();
  });
});

describe('apiErrorRetryAfterMs', () => {
  it('reads retryAfterMs off the details payload', () => {
    const err = new ApiError('x', 429, {
      error: { details: { retryAfterMs: 5000 } },
    });
    expect(apiErrorRetryAfterMs(err)).toBe(5000);
  });

  it('returns null for zero or non-numeric values', () => {
    expect(apiErrorRetryAfterMs(new ApiError('x', 429, { error: { details: { retryAfterMs: 0 } } }))).toBeNull();
    expect(apiErrorRetryAfterMs(new ApiError('x', 429, { error: { details: { retryAfterMs: 'nope' } } }))).toBeNull();
  });

  it('returns null on non-ApiError', () => {
    expect(apiErrorRetryAfterMs(new Error('x'))).toBeNull();
  });

  it('returns null when the details block is missing or not an object', () => {
    expect(apiErrorRetryAfterMs(new ApiError('x', 429, undefined))).toBeNull();
    expect(apiErrorRetryAfterMs(new ApiError('x', 429, { error: { details: 'nope' } }))).toBeNull();
  });
});
