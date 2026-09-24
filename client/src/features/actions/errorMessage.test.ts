import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => `[t:${key}]`,
  },
}));

// Use the real ApiError so its instanceof/signature semantics stay honest.
// (The i18next mock above still redirects the localized fallback.)

import { ApiError } from '@shared/api/client';
import {
  actionsErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
  errorMessage,
} from './errorMessage';

beforeEach(() => vi.clearAllMocks());

describe('actions errorMessage', () => {
  it('prefers server-provided error.message', () => {
    const err = new ApiError('msg', 409, {
      error: { message: 'Version mismatch' },
    });
    expect(errorMessage(err)).toBe('Version mismatch');
  });

  it('falls back to a localized network key', () => {
    const err = new ApiError('msg', 0, null, 'network');
    expect(errorMessage(err)).toBe('[t:errors:network]');
  });

  it('falls back to actions:errors.loadFailed for plain unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe(
      '[t:actions:errors.loadFailed]',
    );
  });

  it('re-exports helpers unchanged', () => {
    expect(apiErrorStatus(new ApiError('m', 402, {}))).toBe(402);
    expect(apiErrorStatus('not an api error')).toBeNull();
    expect(
      apiErrorRetryAfterMs(
        new ApiError('m', 429, {
          error: { details: { retryAfterMs: 5000 } },
        }),
      ),
    ).toBe(5000);
    expect(
      actionsErrorMessage(new Error('x'), 'actions:errors.loadFailed'),
    ).toBe('[t:actions:errors.loadFailed]');
  });
});
