import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/client';
import { i18n, initI18n } from '@shared/i18n';
import { accountErrorMessage } from './errorMessage';

const FALLBACK = 'account:privacy.export.error';

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
});

describe('accountErrorMessage', () => {
  it('returns the server-provided localized message', () => {
    const err = new ApiError('failed', 400, { error: { message: 'Server says no.' } });
    expect(accountErrorMessage(err, FALLBACK)).toBe('Server says no.');
  });

  it('falls back when the ApiError has no structured error', () => {
    const err = new ApiError('failed', 400, { nope: true });
    expect(accountErrorMessage(err, FALLBACK)).toBe(i18n.t(FALLBACK));
  });

  it('falls back when the error field is not an object with a message', () => {
    const err = new ApiError('failed', 400, { error: 'plain string' });
    expect(accountErrorMessage(err, FALLBACK)).toBe(i18n.t(FALLBACK));
  });

  it('falls back for a non-ApiError value', () => {
    expect(accountErrorMessage(new Error('boom'), FALLBACK)).toBe(i18n.t(FALLBACK));
  });
});
