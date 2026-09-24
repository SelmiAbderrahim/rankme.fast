import { z } from 'zod';
import { RANK_ENGINES, type RankEngineKind } from '../../db/schema/keywords.js';
import { HttpError } from '../../shared/utils/http-error.js';
// Zod boundary schemas for /api/v1/*.
/** Mongo ObjectId hex — malformed ids fail fast with a 400 before any query. */
export const v1SiteIdParamsSchema = z.object({
    siteId: z.string().regex(/^[0-9a-f]{24}$/i),
});
const isoDateSchema = z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'errors.validationFailed',
});
export const v1FormatQuerySchema = z.object({
    format: z.literal('csv').optional(),
});
export const V1_RANK_HISTORY_CSV_PAGE_LIMIT = 25;
export const v1RankHistoryCsvPagingQuerySchema = v1FormatQuerySchema.extend({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(V1_RANK_HISTORY_CSV_PAGE_LIMIT)
        .default(V1_RANK_HISTORY_CSV_PAGE_LIMIT),
    cursor: z.string().min(1).max(2048).optional(),
});
export const v1KeywordCsvPagingQuerySchema = v1FormatQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    cursor: z.string().min(1).max(2048).optional(),
});
const v1LegacyCsvCursorSchema = z
    .object({
    v: z.literal(1),
    siteId: z.string().regex(/^[0-9a-f]{24}$/i),
    keywordCursor: z.string().uuid().nullable(),
})
    .strict();
export interface V1LegacyCsvCursor {
    v: 1;
    siteId: string;
    keywordCursor: string | null;
}
export function encodeV1LegacyCsvCursor(siteId: string, keywordCursor: string | null): string {
    const payload: V1LegacyCsvCursor = { v: 1, siteId, keywordCursor };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
export function decodeV1LegacyCsvCursor(value: string): V1LegacyCsvCursor {
    try {
        if (!/^[A-Za-z0-9_-]+$/u.test(value))
            throw new Error('invalid base64url');
        const raw = Buffer.from(value, 'base64url').toString('utf8');
        const parsed = v1LegacyCsvCursorSchema.parse(JSON.parse(raw));
        if (encodeV1LegacyCsvCursor(parsed.siteId, parsed.keywordCursor) !== value) {
            throw new Error('non-canonical cursor');
        }
        return parsed;
    }
    catch (cause) {
        throw new HttpError(400, { code: 'PUBLIC_API_ERRORS_INVALID_CURSOR', messageKey: 'publicApi.errors.invalidCursor' }, undefined, {
            cause,
        });
    }
}
const v1HistoryQueryBaseSchema = v1FormatQuerySchema.extend({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    engine: z.string().trim().min(1).optional(),
});
export interface V1HistoryQuery {
    from?: string;
    to?: string;
    engine?: RankEngineKind;
    format?: 'csv';
}
export function parseV1HistoryQuery(input: unknown): V1HistoryQuery {
    const parsed = v1HistoryQueryBaseSchema.parse(input);
    if (parsed.engine !== undefined && !(RANK_ENGINES as readonly string[]).includes(parsed.engine)) {
        throw HttpError.badRequest({ code: 'PUBLIC_API_ERRORS_INVALID_ENGINE', messageKey: 'publicApi.errors.invalidEngine' });
    }
    return parsed as V1HistoryQuery;
}
export const v1StoredRowsQuerySchema = v1FormatQuerySchema.extend({
    siteId: z.string().regex(/^[0-9a-f]{24}$/i),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    cursor: z.string().min(1).max(2048).optional(),
});
export type V1SiteIdParams = z.infer<typeof v1SiteIdParamsSchema>;
export type V1FormatQuery = z.infer<typeof v1FormatQuerySchema>;
export type V1RankHistoryCsvPagingQuery = z.infer<typeof v1RankHistoryCsvPagingQuerySchema>;
export type V1KeywordCsvPagingQuery = z.infer<typeof v1KeywordCsvPagingQuerySchema>;
export type V1StoredRowsQuery = z.infer<typeof v1StoredRowsQuerySchema>;
