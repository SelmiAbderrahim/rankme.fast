import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/client';
import { changeLanguage, initI18n } from '@shared/i18n';
import {
  assistantErrorKind,
  assistantErrorMessage,
  assistantStreamError,
} from './errorMessage';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('assistant error mapping', () => {
  it.each([
    [new ApiError('x', 403, null), 'forbidden'],
    [new ApiError('x', 429, null), 'rate_limited'],
    [new ApiError('x', 503, null), 'unavailable'],
    [new Error('x'), 'generic'],
  ] as const)('maps %s to %s', (error, kind) => {
    expect(assistantErrorKind(error)).toBe(kind);
  });

  it('keeps a localized server message and retry metadata in serializable state', () => {
    const error = new ApiError('x', 429, {
      error: {
        message: 'Wait before trying again.',
        details: { retryAfterMs: 2500 },
      },
    });
    expect(assistantErrorMessage(error)).toEqual({
      kind: 'rate_limited',
      message: 'Wait before trying again.',
      status: 429,
      retryAfterMs: 2500,
      code: null,
    });
  });

  it('uses localized fallbacks for HTTP, network, stream, and unknown failures', () => {
    expect(assistantErrorMessage(new ApiError('x', 503, null)).message).toBe(
      'The AI Assistant is temporarily unavailable.',
    );
    expect(
      assistantErrorMessage(new ApiError('x', 0, null, 'network')).message,
    ).toBe('Network request failed. Check your connection and try again.');
    expect(assistantErrorMessage(null).message).toBe(
      'The assistant request failed. Try again.',
    );
    expect(assistantStreamError(null)).toMatchObject({
      kind: 'stream',
      message: 'The response stopped unexpectedly. Try sending your message again.',
      code: null,
    });
    expect(assistantStreamError('Provider stopped.', 'provider_error')).toMatchObject({
      message: 'Provider stopped.',
      code: 'provider_error',
    });
  });
});
