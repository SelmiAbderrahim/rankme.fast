import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { authClient } from './authClient';
import { useAuthSession } from './useAuthSession';
import type { AuthSessionUser } from './types';

vi.mock('./authClient', () => ({
  authClient: { useSession: vi.fn() },
}));

const useSession = authClient.useSession as unknown as Mock;

describe('useAuthSession', () => {
  it('reports pending while the session fetch is in flight', () => {
    useSession.mockReturnValue({ data: null, isPending: true });
    const { result } = renderHook(() => useAuthSession());
    expect(result.current).toEqual({
      authenticated: false,
      isPending: true,
      emailVerified: false,
      mustChangePassword: false,
      provisionalAccount: false,
      refetch: undefined,
      user: null,
    });
  });

  it('maps an anonymous resolution to unauthenticated', () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.authenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('exposes the session user when authenticated', () => {
    const user = { id: 'u-1', email: 'a@b.co', emailVerified: true } as AuthSessionUser;
    useSession.mockReturnValue({ data: { user }, isPending: false });
    const { result } = renderHook(() => useAuthSession());
    expect(result.current).toEqual({
      authenticated: true,
      isPending: false,
      emailVerified: true,
      mustChangePassword: false,
      provisionalAccount: false,
      refetch: undefined,
      user,
    });
  });

  it('treats a missing emailVerified flag as unverified', () => {
    const user = { id: 'u-1', email: 'a@b.co' } as AuthSessionUser;
    useSession.mockReturnValue({ data: { user }, isPending: false });
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.emailVerified).toBe(false);
  });
});
