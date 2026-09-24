import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import { googleErrorMessage } from './errorMessage';

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

describe('googleErrorMessage', () => {
  it('returns the server-localized error.message when present', () => {
    const err = new ApiError('x', 400, { error: { message: 'server says no' } });
    expect(googleErrorMessage(err, 'google:errors.unavailable')).toBe('server says no');
  });

  it('falls back to the localized key on a network-level failure', () => {
    expect(googleErrorMessage(new TypeError('offline'), 'google:errors.unavailable')).toBe(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
  });

  it('falls back when ApiError has no error.message field', () => {
    const err = new ApiError('x', 500, { error: {} });
    expect(googleErrorMessage(err, 'google:errors.loadFailed')).toBe(
      'Could not load your Google connection.',
    );
  });

  it('falls back when ApiError data is not an object with error key', () => {
    const err = new ApiError('x', 500, 'plain text body');
    expect(googleErrorMessage(err, 'google:errors.disconnectFailed')).toBe(
      'Could not disconnect.',
    );
  });

  it('falls back when the error field is not an object', () => {
    const err = new ApiError('x', 500, { error: 'oops' });
    expect(googleErrorMessage(err, 'google:errors.unavailable')).toBe(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
  });

  it('falls back when the error.message is not a string', () => {
    const err = new ApiError('x', 500, { error: { message: 42 } });
    expect(googleErrorMessage(err, 'google:errors.unavailable')).toBe(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
  });
});
