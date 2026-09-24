export { authClient } from './authClient';
export { useAuthSession, type AuthSessionState } from './useAuthSession';
export { authRoutes } from './routes';
export { ActiveSessions } from './components/ActiveSessions';
export { ChangeEmail } from './components/ChangeEmail';
export { ChangePassword } from './components/ChangePassword';
export { DeleteAccount } from './components/DeleteAccount';
export { deleteAccount, type AccountDeletionScheduled } from './api';
export { RequireAuth } from './components/RequireAuth';
export { RequireVerified } from './components/RequireVerified';
export { RequirePasswordCurrent } from './components/RequirePasswordCurrent';
export { RequiredPasswordChangePage } from './components/RequiredPasswordChangePage';
export { RedirectIfAuthed } from './components/RedirectIfAuthed';
export { SecuritySettings } from './components/SecuritySettings';
export { SessionPending } from './components/SessionPending';
export { messageForAuthError, type AuthClientError } from './errorMessage';
export {
  authEntryHref,
  authSuccessHref,
  loginHrefForReturnTo,
  requiredPasswordChangeHref,
  safeTeamReturnTo,
  verifyEmailHref,
} from './intent';
export type { AuthSession, AuthSessionUser } from './types';
