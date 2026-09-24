import { afterEach, describe, expect, it, vi } from 'vitest';
import { User } from '../users/users.model.js';
import {
  isPendingProvisionedIdentity,
  provisionInvitationIdentity,
} from './provisional-account.js';

function authHarness(input: {
  created?: { id: string } | null;
  linkError?: Error;
  pending?: unknown;
} = {}) {
  const internalAdapter = {
    createUser: vi.fn().mockResolvedValue(input.created === undefined ? { id: 'user-1' } : input.created),
    linkAccount: input.linkError
      ? vi.fn().mockRejectedValue(input.linkError)
      : vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    findUserById: vi.fn().mockResolvedValue(
      input.pending === undefined ? null : { mustChangePassword: input.pending },
    ),
  };
  const auth = {
    $context: Promise.resolve({
      password: { hash: vi.fn().mockResolvedValue('password-hash') },
      internalAdapter,
    }),
  };
  return { auth: auth as never, internalAdapter };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provisional invitation identity boundaries', () => {
  it('rejects when Better Auth does not create an identity', async () => {
    const { auth } = authHarness({ created: null });

    await expect(
      provisionInvitationIdentity('Invitee@Example.com', 'temporary-password', auth),
    ).rejects.toThrow('Better Auth did not create the invited identity');
  });

  it('scrubs the mirror and Better Auth identity when credential linking fails', async () => {
    const linkError = new Error('link failed');
    const { auth, internalAdapter } = authHarness({ linkError });
    const deleteMirror = vi.spyOn(User, 'deleteOne').mockResolvedValue({ acknowledged: true } as never);
    const created = vi.fn();

    await expect(
      provisionInvitationIdentity(
        ' Invitee@Example.com ',
        'temporary-password',
        auth,
        created,
      ),
    ).rejects.toBe(linkError);
    expect(created).toHaveBeenCalledWith('user-1');
    expect(internalAdapter.deleteUser).toHaveBeenCalledWith('user-1');
    expect(deleteMirror).toHaveBeenCalledWith({ _id: 'user-1' });
  });

  it('reads both pending and absent provisioned identity states', async () => {
    const pending = authHarness({ pending: true });
    const absent = authHarness();

    await expect(isPendingProvisionedIdentity('user-1', pending.auth)).resolves.toBe(true);
    await expect(isPendingProvisionedIdentity('user-2', absent.auth)).resolves.toBe(false);
  });
});
