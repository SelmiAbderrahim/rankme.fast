import type express from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  continueWithAccountWorkLease: vi.fn(async () => false),
  markTokenAuthenticated: vi.fn(),
  resolveApiKey: vi.fn(async () => ({
    accountId: 'account-one',
    keyId: 'key-one',
    scopes: null,
  })),
  touchLastUsed: vi.fn(async () => undefined),
}));

vi.mock('../api-keys/index.js', () => ({
  resolveApiKey: mocks.resolveApiKey,
  touchLastUsed: mocks.touchLastUsed,
}));

vi.mock('../users/index.js', () => ({
  User: {
    findById: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: vi.fn(async () => ({ suspended: false })),
      })),
    })),
  },
}));

vi.mock('../../shared/middleware/rate-limit.js', () => ({
  markTokenAuthenticated: mocks.markTokenAuthenticated,
}));

vi.mock('../legal/account-lifecycle.middleware.js', () => ({
  continueWithAccountWorkLease: mocks.continueWithAccountWorkLease,
}));

import { createApiKeyAuth } from './api-key-auth.js';

describe('public API key account lease', () => {
  it('fails closed when account deletion wins after key ownership is checked', async () => {
    const middleware = createApiKeyAuth(() => ({}) as never);
    const req = {
      get: (name: string) =>
        name === 'authorization' ? 'Bearer rmf_valid_key' : undefined,
      id: 'request-one',
    } as unknown as express.Request;
    const res = {} as express.Response;
    const next = vi.fn();

    middleware(req, res, next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'publicApi.errors.invalidKey',
        status: 401,
      }),
    );
    expect(mocks.touchLastUsed).not.toHaveBeenCalled();
  });
});
