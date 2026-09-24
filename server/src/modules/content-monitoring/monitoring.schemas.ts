/**
 * Public-page change monitoring — request schemas.
 *
 * Provider-neutral zod shapes for the monitor CRUD + change-feed surface. Every
 * user-supplied URL passes `safeUrlString` (shape-level) at the schema seam and
 * the runtime `assertPublicUrlSafe` (DNS/redirect pinning) in the service. The
 * cadence is fixed weekly this release, so it is NOT a request field.
 */
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { safeUrlString } from '../../shared/security/index.js';
import { CONTENT_MONITOR_TARGET_KINDS } from './monitor.model.js';
export const siteIdParamsSchema = z
    .object({ siteId: z.string().min(1).max(64) })
    .strict();
export const monitorIdParamsSchema = z
    .object({
    siteId: z.string().min(1).max(64),
    monitorId: z.string().min(1).max(64),
})
    .strict();
/** Create a monitor for an owned OR confirmed-competitor public page. */
export const createMonitorBodySchema = z
    .object({
    targetUrl: safeUrlString,
    targetKind: z.enum(CONTENT_MONITOR_TARGET_KINDS),
    /** Notification/email language for material-change alerts. */
    locale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export type CreateMonitorBody = z.infer<typeof createMonitorBodySchema>;
export const listMonitorsQuerySchema = z
    .object({
    status: z.enum(['active', 'paused', 'error', 'all']).default('all'),
})
    .strict();
export type ListMonitorsQuery = z.infer<typeof listMonitorsQuerySchema>;
export const changeFeedQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
export type ChangeFeedQuery = z.infer<typeof changeFeedQuerySchema>;
