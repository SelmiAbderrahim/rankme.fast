import type { TeamRole } from '@features/team';

/**
 * Which client routes each TEAM role may open inside a FOREIGN workspace
 * (`rankme-enterprise-orgs` 02).
 *
 * One map, not per-page forks. It mirrors the server's owner-only mounts —
 * `/api/api-keys`, `/api/mcp-permissions`, and the branding write — so the nav
 * never offers a destination that answers 404.
 *
 * Own-workspace behavior is untouched: the role is `owner` there, and every
 * entry is visible exactly as before this feature existed.
 *
 * Routes NOT listed here are ordinary workspace work and stay visible to every
 * accepted role. Actor-scoped surfaces (profile, notifications, security, data
 * rights) also stay visible: they are about the signed-in human, and the API
 * client deliberately omits the workspace header on them.
 */
export const OWNER_ONLY_ROUTES = [
  '/settings/api-keys',
  '/settings/mcp',
] as const;

/** Team management is admin+; a plain member has no business on this page. */
export const ADMIN_ONLY_ROUTES = ['/settings/team'] as const;

const startsWithRoute = (pathname: string, route: string): boolean =>
  pathname === route || pathname.startsWith(`${route}/`);

/**
 * Whether a role may open a route. `isForeign` is required because the same
 * role name (`owner`) means "my own account" outside a foreign workspace.
 */
export const canOpenRoute = (
  pathname: string,
  role: TeamRole,
  isForeign: boolean,
): boolean => {
  if (!isForeign) return true;
  if (OWNER_ONLY_ROUTES.some((route) => startsWithRoute(pathname, route))) {
    return role === 'owner';
  }
  if (ADMIN_ONLY_ROUTES.some((route) => startsWithRoute(pathname, route))) {
    return role === 'owner' || role === 'admin';
  }
  return true;
};
