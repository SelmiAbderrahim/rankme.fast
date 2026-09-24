import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import { siteErrorMessage } from './errorMessage';

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

describe('siteErrorMessage', () => {
  it('prefers the server-localized error message', () => {
    const err = new ApiError('req failed', 409, {
      error: { message: 'That site is already in your account.' },
    });
    expect(siteErrorMessage(err, 'sites:addFailed')).toBe(
      'That site is already in your account.',
    );
  });

  it('falls back when the error body has no message string', () => {
    const err = new ApiError('req failed', 500, { error: { message: 42 } });
    expect(siteErrorMessage(err, 'sites:addFailed')).toBe('Could not add the site.');
  });

  it('falls back when error is not an object', () => {
    const err = new ApiError('req failed', 500, { error: 'nope' });
    expect(siteErrorMessage(err, 'sites:deleteFailed')).toBe('Could not delete the site.');
  });

  it('falls back when the body has no error key', () => {
    const err = new ApiError('req failed', 500, { unrelated: true });
    expect(siteErrorMessage(err, 'sites:loadFailed')).toBe('Could not load your sites.');
  });

  it('falls back when the body is not an object', () => {
    const err = new ApiError('req failed', 500, 'plain text');
    expect(siteErrorMessage(err, 'sites:loadFailed')).toBe('Could not load your sites.');
  });

  it('falls back for non-ApiError values', () => {
    expect(siteErrorMessage(new Error('boom'), 'sites:loadFailed')).toBe(
      'Could not load your sites.',
    );
  });
});
