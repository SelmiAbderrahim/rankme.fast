import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { authClient } from './authClient';
import { sessionMutation } from './sessionMutation';

const transport = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock('./authClient', async () => {
  const { createAuthClient } = await import('better-auth/react');
  return {
    authClient: createAuthClient({
      baseURL: 'http://localhost/api/auth',
      fetchOptions: { customFetchImpl: transport.fetch },
    }),
  };
});
afterEach(cleanup);

it('waits for the native session refresh after sign-in and sign-out', async () => {
  let signedIn = false;
  let reads = 0;
  transport.fetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/sign-in/email')) signedIn = true;
    if (path.endsWith('/sign-out')) signedIn = false;
    if (path.endsWith('/get-session')) {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json(signedIn ? {
        user: { id: 'user', emailVerified: true },
        session: { id: 'session' },
      } : null);
    }
    return Response.json({ user: { id: 'user' } });
  });

  function Subscriber() {
    authClient.useSession();
    return null;
  }
  render(<Subscriber />);
  await waitFor(() => expect(authClient.$store.atoms.session?.get().isPending).toBe(false));
  const baseline = reads;
  await sessionMutation(() => authClient.signIn.email({ email: 'user@example.test', password: 'synthetic-password' }));
  expect(authClient.$store.atoms.session?.get().data?.user.id).toBe('user');
  expect(reads - baseline).toBe(1);
  await sessionMutation(() => authClient.signOut());
  expect(authClient.$store.atoms.session?.get().data).toBeNull();
  expect(reads - baseline).toBe(2);
});
