import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import {
  errorMessage,
  audienceResearchErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
} from './errorMessage';

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

describe('audience-research errorMessage', () => {
  it('prefers the server-localized error message', () => {
    const err = new ApiError('req failed', 402, {
      error: { message: 'You have used every audience research run on your plan this month.' },
    });
    expect(errorMessage(err)).toBe(
      'You have used every audience research run on your plan this month.',
    );
  });

  it('falls back to the generic namespaced key when the body has no message', () => {
    const err = new ApiError('req failed', 500, { unrelated: true });
    expect(errorMessage(err)).toBe(errorMessage(new Error('x')));
  });

  it('falls back for non-ApiError values', () => {
    expect(typeof errorMessage(new Error('boom'))).toBe('string');
    expect(errorMessage(new Error('boom')).length).toBeGreaterThan(0);
  });

  it('re-exports the shared helpers under a namespaced alias', () => {
    expect(audienceResearchErrorMessage).toBeTypeOf('function');
    expect(apiErrorStatus(new ApiError('x', 404, {}))).toBe(404);
    expect(apiErrorRetryAfterMs(new Error('x'))).toBeNull();
  });
});
