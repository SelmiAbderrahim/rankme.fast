import { authClient } from './authClient';
import type { AuthSessionUser } from './types';

export interface AuthSessionState {
  /** True once a live session is confirmed. */
  authenticated: boolean;
  /** True while the initial session fetch is in flight. */
  isPending: boolean;
  emailVerified: boolean;
  /** True only for a system-provisioned identity using its temporary password. */
  mustChangePassword?: boolean;
  /** Remains true after the password is replaced until one invitation is accepted. */
  provisionalAccount?: boolean;
  refetch?: () => Promise<unknown>;
  user: AuthSessionUser | null;
}

/**
 * Session state for the whole app — a thin, stable-shaped wrapper over
 * `authClient.useSession()`. Route guards, the header, and feature screens
 * all read from this hook; there is no Redux mirror of auth state.
 */
export const useAuthSession = (): AuthSessionState => {
  const { data, isPending, refetch } = authClient.useSession();
  return {
    authenticated: Boolean(data),
    isPending,
    emailVerified: data?.user.emailVerified ?? false,
    mustChangePassword: data?.user.mustChangePassword === true,
    provisionalAccount: data?.user.provisionalAccount === true,
    refetch,
    user: data?.user ?? null,
  };
};
