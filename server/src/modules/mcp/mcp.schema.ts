import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { ACTION_SOURCE_TYPES, ACTION_STATES, MAX_LIST_LIMIT, } from '../actions/index.js';
/**
 * Bounded input shapes for every MCP tool. Same defense-in-depth pattern as
 * the REST /api/v1 schemas — validate at the handler boundary, reject before
 * any DB/vendor call, and use narrow types (Mongo hex, UUID, enum locale) so
 * malformed arguments 400 fast without leaking existence.
 */
const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/i, {
    message: 'errors.validationFailed',
});
const uuidLoose = z.string().regex(/^[0-9a-f-]{36}$/i, {
    message: 'errors.validationFailed',
});
const isoDateSchema = z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'errors.validationFailed',
});
const localeSchema = z.enum(SUPPORTED_LOCALES).optional();
/** Cursor is opaque and length-bounded to defeat oversized/tampered inputs. */
const cursorSchema = z.string().min(1).max(1024).optional();
/** Per-tool page ceiling — matches the REST V1_KEYWORD_LIMIT. */
export const MCP_PAGE_LIMIT_MAX = 100;
export const MCP_PAGE_LIMIT_DEFAULT = 25;
const limitSchema = z.coerce
    .number()
    .int()
    .min(1)
    .max(MCP_PAGE_LIMIT_MAX)
    .default(MCP_PAGE_LIMIT_DEFAULT);
export const listSitesInputSchema = z
    .object({
    locale: localeSchema,
})
    .strict();
export const getLatestAuditReportInputSchema = z
    .object({
    siteId: objectIdHex,
    locale: localeSchema,
})
    .strict();
export const listKeywordsInputSchema = z
    .object({
    siteId: objectIdHex,
    limit: limitSchema.optional(),
    locale: localeSchema,
})
    .strict();
export const getRankHistoryInputSchema = z
    .object({
    siteId: objectIdHex,
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    locale: localeSchema,
})
    .strict();
export const listContentAnalysesInputSchema = z
    .object({
    siteId: objectIdHex,
    limit: limitSchema.optional(),
    cursor: cursorSchema,
    locale: localeSchema,
})
    .strict();
export const getContentAnalysisInputSchema = z
    .object({
    analysisId: objectIdHex,
    locale: localeSchema,
})
    .strict();
export const startAuditInputSchema = z
    .object({
    siteId: objectIdHex,
    pageCap: z.coerce.number().int().positive().max(10000).optional(),
    locale: localeSchema,
})
    .strict();
export const getAuditStatusInputSchema = z
    .object({
    runId: objectIdHex,
    locale: localeSchema,
})
    .strict();
/** Server-minted sha256 action id — the preimage never leaves the server. */
const actionIdHash = z.string().regex(/^[a-f0-9]{64}$/, {
    message: 'errors.validationFailed',
});
/** Offset cursor minted by `listActionsForSite` — digits only, same as REST. */
const actionCursorSchema = z.string().regex(/^\d{1,9}$/).optional();
const actionListLimitSchema = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .optional();
export const listActionsInputSchema = z
    .object({
    siteId: objectIdHex,
    state: z.array(z.enum(ACTION_STATES)).max(ACTION_STATES.length).optional(),
    source: z
        .array(z.enum(ACTION_SOURCE_TYPES))
        .max(ACTION_SOURCE_TYPES.length)
        .optional(),
    severity: z.array(z.enum(['critical', 'warning', 'info'])).max(3).optional(),
    limit: actionListLimitSchema,
    cursor: actionCursorSchema,
    locale: localeSchema,
})
    .strict();
/**
 * `clientKey` feeds the server-derived idempotency key
 * `sha256(accountId, actionId, expectedVersion, clientKey)`. The browser mints
 * a fresh UUID per dialog so each deliberate click is its own event; an agent
 * wants the opposite, so this DEFAULTS to a fixed literal — retrying the exact
 * same transition replays instead of racing a second write.
 */
export const setActionStateInputSchema = z
    .object({
    siteId: objectIdHex,
    actionId: actionIdHash,
    state: z.enum(ACTION_STATES),
    expectedVersion: z.coerce.number().int().min(0),
    note: z.string().max(2000).optional(),
    clientKey: z.string().min(1).max(200).default('mcp'),
    locale: localeSchema,
})
    .strict();
export type ListSitesInput = z.infer<typeof listSitesInputSchema>;
export type GetLatestAuditReportInput = z.infer<typeof getLatestAuditReportInputSchema>;
export type ListKeywordsInput = z.infer<typeof listKeywordsInputSchema>;
export type GetRankHistoryInput = z.infer<typeof getRankHistoryInputSchema>;
export type ListContentAnalysesInput = z.infer<typeof listContentAnalysesInputSchema>;
export type GetContentAnalysisInput = z.infer<typeof getContentAnalysisInputSchema>;
export type StartAuditInput = z.infer<typeof startAuditInputSchema>;
export type GetAuditStatusInput = z.infer<typeof getAuditStatusInputSchema>;
export type ListActionsInput = z.infer<typeof listActionsInputSchema>;
export type SetActionStateInput = z.infer<typeof setActionStateInputSchema>;
/** Silence `uuidLoose` unused-import warnings until a future tool needs it. */
export const _uuidLoose = uuidLoose;
