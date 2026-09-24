import { describe, expect, it } from 'vitest';
import { requireUserId } from './require-user-id.js';

describe('requireUserId', () => {
  it('throws a 401 HttpError when no user is present', () => {
    expect(() => requireUserId(undefined)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('returns the id when a user is present', () => {
    expect(requireUserId({ id: 'user-123' } as Express.User)).toBe('user-123');
  });
});
