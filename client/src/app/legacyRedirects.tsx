import type { RouteObject } from 'react-router-dom';
import { RedirectPreservingState } from '@shared/navigation/RedirectPreservingState';

/** Portable aliases, ready for account settings consolidation. Not mounted yet. */
export const LEGACY_APP_REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'profile', to: '/settings/profile' },
  { from: 'settings', to: '/settings/profile' },
];
export const legacyAppRedirectRoutes: RouteObject[] = LEGACY_APP_REDIRECTS.map(
  ({ from, to }) => ({ path: from, element: <RedirectPreservingState to={to} /> }),
);
