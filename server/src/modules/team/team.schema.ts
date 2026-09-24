import { z } from 'zod';
const objectIdHex = z.string().regex(/^[a-f\d]{24}$/iu);
const selectedSiteIdsSchema = z
    .array(objectIdHex)
    .min(1)
    .max(500)
    .superRefine((siteIds, ctx) => {
    if (new Set(siteIds).size !== siteIds.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'validation.custom.siteIdsUnique',
        });
    }
});
export const teamSiteAccessSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all') }).strict(),
    z.object({ mode: z.literal('selected'), siteIds: selectedSiteIdsSchema }).strict(),
]);
export type TeamSiteAccessInput = z.infer<typeof teamSiteAccessSchema>;
/**
 * Request-body schemas for the team module.
 * Email is validated + lowercased so the seat-cap dedup index matches.
 */
export const inviteMemberSchema = z.object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .email()
        .max(254),
    role: z.enum(['admin', 'member']).default('member'),
    siteAccess: teamSiteAccessSchema.default({ mode: 'all' }),
});
export type InviteMemberBody = z.infer<typeof inviteMemberSchema>;
export const acceptInviteParamsSchema = z.object({
    token: z.string().min(16).max(200),
});
export type AcceptInviteParams = z.infer<typeof acceptInviteParamsSchema>;
export const memberIdParamsSchema = z.object({
    id: z.string().uuid(),
});
export const invitationTokenParamsSchema = z.object({
    token: z.string().min(16).max(200),
});
export type MemberIdParams = z.infer<typeof memberIdParamsSchema>;
/**
 * Roster query (`rankme-enterprise-orgs` 02). `coerce` because these arrive as
 * query strings; the bounds are the operator ceiling, so a caller cannot ask
 * for an unbounded page.
 */
export const listTeamQuerySchema = z.object({
    query: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListTeamQueryParams = z.infer<typeof listTeamQuerySchema>;
/**
 * Role assignment (`rankme-enterprise-orgs` 02). `owner` is deliberately not
 * accepted: ownership is not transferable here, so the only legal moves are
 * member <-> admin. A request naming `owner` is a 400 from zod, before the
 * service ever loads the row.
 */
export const changeMemberRoleSchema = z.object({
    role: z.enum(['admin', 'member']),
});
export const updateMemberAccessSchema = z.object({
    role: z.enum(['admin', 'member']),
    siteAccess: teamSiteAccessSchema,
});
export type UpdateMemberAccessBody = z.infer<typeof updateMemberAccessSchema>;
export type ChangeMemberRoleBody = z.infer<typeof changeMemberRoleSchema>;
