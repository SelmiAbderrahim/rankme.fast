import 'express';
import type { SupportedLocale, TranslationVars } from '../i18n/index.js';
import type { TeamMemberRole } from '../../db/schema/team-members.js';
import type { McpPermissionSpec } from '../mcp-permissions/types.js';
declare global {
    namespace Express {
        // Identity attached by `requireAuth` from the Better Auth session.
        interface User {
            id: string;
            email?: string;
            role?: string;
            emailVerified?: boolean;
            mustChangePassword?: boolean;
            provisionalAccount?: boolean;
            twoFactorEnabled?: boolean;
            // Session freshness. Populated from the Better Auth session's
            // `createdAt` timestamp, so each fresh sign-in advances it.
            recentAuthAt?: string;
        }
        interface Request {
            id: string;
            language: SupportedLocale;
            t: (key: string, vars?: TranslationVars) => string;
            // Populated by `requireAuth` (passport previously provided this slot).
            user?: User;
            // Populated by the /api/v1 bearer-key auth (`createApiKeyAuth`) — the
            // id of the api_keys row that authenticated this request.
            apiKeyId?: string;
            // Per-key MCP permission scopes from the authenticating api_keys row
            //. null = unscoped key (fully permissive);
            // undefined = request not bearer-key authenticated (cookie session).
            apiKeyScopes?: McpPermissionSpec | null;
            // Workspace context. Populated by
            // `workspaceContext()` on the product chain: the account that owns the
            // data this request touches, and the caller's TEAM role inside it.
            // Absent on routes mounted without the middleware (bearer-key /api/v1,
            // MCP, admin/superadmin) — `requireAccountId(req)` falls back to the
            // caller's own id there. The team role is orthogonal to the PLATFORM
            // role on `Express.User['role']`.
            workspaceAccountId?: string;
            teamRole?: TeamMemberRole;
            /**
             * Per-site team authorization resolved with the accepted membership.
             * Owners and all-scoped members carry `all`; selected memberships carry
             * the immutable set of Site ids granted to that membership. These fields
             * are absent outside the cookie-authenticated product chain.
             */
            teamMembershipId?: string;
            teamSiteAccessMode?: 'all' | 'selected';
            teamSiteIds?: ReadonlySet<string>;
            /** Proven SHA-256 digest for the public report-share limiter; never logged. */
            reportShareTokenHash?: string;
        }
    }
}
export {};
