import type { authClient } from './authClient';

/** Session shape as inferred from the Better Auth client (cookie-backed). */
export type AuthSession = (typeof authClient)['$Infer']['Session'];
export type AuthSessionUser = AuthSession['user'];
