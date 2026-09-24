import type { RouteObject } from 'react-router-dom';
import { ForgotPassword } from './components/ForgotPassword';
import { Login } from './components/Login';
import { Logout } from './components/Logout';
import { RedirectIfAuthed } from './components/RedirectIfAuthed';
import { Register } from './components/Register';
import { RequireVerified } from './components/RequireVerified';
import { ResetPassword } from './components/ResetPassword';
import { SecuritySettings } from './components/SecuritySettings';
import { TwoFactorChallenge } from './components/TwoFactorChallenge';
import { VerifyEmail } from './components/VerifyEmail';

export const authRoutes: RouteObject[] = [
  // Guest-only surfaces: an authenticated visitor is bounced to the product
  // shell (or /verify-email when still unverified) instead of seeing a stale
  // login/register form.
  {
    path: 'login',
    element: (
      <RedirectIfAuthed>
        <Login />
      </RedirectIfAuthed>
    ),
  },
  {
    path: 'register',
    element: (
      <RedirectIfAuthed>
        <Register />
      </RedirectIfAuthed>
    ),
  },
  {
    path: 'forgot-password',
    element: (
      <RedirectIfAuthed>
        <ForgotPassword />
      </RedirectIfAuthed>
    ),
  },
  {
    path: 'reset-password',
    element: (
      <RedirectIfAuthed>
        <ResetPassword />
      </RedirectIfAuthed>
    ),
  },
  { path: 'logout', element: <Logout /> },
  // Better Auth lands here with `?token=` (or `?error=`) after the server
  // pre-checks the emailed link — handled by the RedirectIfAuthed-wrapped
  // `reset-password` route above.
  { path: 'verify-email', element: <VerifyEmail /> },
  // Second-factor challenge screen. Better Auth's client redirects here on a
  // successful primary auth when the account has a verified second factor;
  // the screen accepts a current TOTP code or a one-time backup code.
  { path: 'two-factor', element: <TwoFactorChallenge /> },
  {
    path: 'settings/security',
    element: (
      <RequireVerified>
        <SecuritySettings />
      </RequireVerified>
    ),
  },
];
