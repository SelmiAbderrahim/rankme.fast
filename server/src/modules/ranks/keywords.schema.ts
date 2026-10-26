import { z } from 'zod';
import { SERP_DEVICES, RANK_CADENCES, RANK_ENGINES } from '../../db/schema/keywords.js';
export const KEYWORD_PHRASE_MAX = 300;
export const BULK_KEYWORDS_MAX = 100;
export const KEYWORD_LIST_PAGE_SIZE_DEFAULT = 25;
export const KEYWORD_LIST_PAGE_SIZE_MAX = 100;
/**
 * The token an alt engine matches on.
 *
 * YouTube: a channel handle, stored lower-case without the leading `@`.
 * Amazon: an ASIN, stored upper-case. Both are compared by EXACT equality
 * against what the provider reports, so normalization has to happen once,
 * here, at the request boundary.
 */
export const YOUTUBE_HANDLE_RE = /^@?[A-Za-z0-9._-]{3,60}$/;
export const AMAZON_ASIN_RE = /^[A-Za-z0-9]{10}$/;
export function normalizeEngineTarget(engine: (typeof RANK_ENGINES)[number], raw: string | undefined): string | null {
    if (raw === undefined)
        return null;
    if (engine === 'youtube')
        return raw.trim().replace(/^@/, '').toLowerCase();
    if (engine === 'amazon')
        return raw.trim().toUpperCase();
    return null;
}
// Body/query/params zod schemas for the ranks module.
// URL params use plain strings because the site/keyword id shape depends on
// the store (Mongoose ObjectId hex for Site, UUID v4 for Keyword) — the
// service performs the specific validation.
const createKeywordFields = z.object({
    phrase: z
        .string()
        .trim()
        .min(1, 'ranks.errors.phraseRequired')
        .max(KEYWORD_PHRASE_MAX, 'ranks.errors.phraseTooLong'),
    locationCode: z.coerce
        .number()
        .int('ranks.errors.locationInvalid')
        .positive('ranks.errors.locationInvalid'),
    languageCode: z
        .string()
        .trim()
        .min(2, 'ranks.errors.languageInvalid')
        .max(10, 'ranks.errors.languageInvalid')
        .transform((s) => s.toLowerCase()),
    device: z.enum(SERP_DEVICES).default('desktop'),
    // Opt-in local-pack (map pack) rank tracking, in addition to
    // the always-on organic check. Adds one maps/live vendor call per sweep.
    trackLocalPack: z.boolean().default(false),
    // The engine this keyword is tracked on.
    // Defaults to `google`, so every request body without an engine field
    // still parses to exactly the shipped Google behaviour.
    engine: z.enum(RANK_ENGINES).default('google'),
    engineTarget: z.string().trim().min(1).max(120).optional(),
});
/**
 * The engine/target pairing is enforced here, not in the service:
 * `youtube` and `amazon` MUST carry a well-formed token (they match nothing
 * without one), while `google` and `bing` MUST NOT (they match the site
 * domain, so a token would be dead configuration). The same invariant is
 * mirrored by the `keywords_engine_target_check` database constraint.
 */
function refineEngineTarget(value: { engine: (typeof RANK_ENGINES)[number]; engineTarget?: string },
    ctx: z.RefinementCtx): void {
    if (value.engine === 'youtube' || value.engine === 'amazon') {
        if (value.engineTarget === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['engineTarget'],
                message: 'ranks.errors.engineTargetRequired' });
            return;
        }
        const pattern = value.engine === 'youtube' ? YOUTUBE_HANDLE_RE : AMAZON_ASIN_RE;
        if (!pattern.test(value.engineTarget)) ctx.addIssue({ code: z.ZodIssueCode.custom,
            path: ['engineTarget'], message: value.engine === 'youtube'
                ? 'ranks.errors.youtubeHandleInvalid' : 'ranks.errors.amazonAsinInvalid' });
        return;
    }
    if (value.engineTarget !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom,
        path: ['engineTarget'], message: 'ranks.errors.engineTargetNotAllowed' });
}
const optionalMarketFields = {
    locationCode: createKeywordFields.shape.locationCode.optional(),
    languageCode: createKeywordFields.shape.languageCode.optional(),
    device: z.enum(SERP_DEVICES).optional(),
};
export const createKeywordSchema = createKeywordFields.extend({
    ...optionalMarketFields,
}).superRefine(refineEngineTarget);
export type CreateKeywordBody = z.infer<typeof createKeywordSchema>;
export const createKeywordsBulkSchema = createKeywordFields.omit({ phrase: true }).extend({
    ...optionalMarketFields,
    phrases: z.array(z.string().max(KEYWORD_PHRASE_MAX * 4, 'ranks.errors.phraseTooLong'))
        .min(1, 'ranks.errors.phraseRequired').max(BULK_KEYWORDS_MAX, 'ranks.errors.bulkTooMany'),
}).superRefine(refineEngineTarget);
export type CreateKeywordsBulkBody = z.infer<typeof createKeywordsBulkSchema>;
export const keywordSuggestionsSchema = createKeywordFields.pick({
    locationCode: true,
    languageCode: true,
});
export type KeywordSuggestionsBody = z.infer<typeof keywordSuggestionsSchema>;
/** Read-only spend/slot disclosure before a paid alt-engine add. */
export const altEnginePreviewSchema = z.object({
    engine: z.enum(RANK_ENGINES),
});
export type AltEnginePreviewBody = z.infer<typeof altEnginePreviewSchema>;
export const listKeywordsQuerySchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(KEYWORD_LIST_PAGE_SIZE_MAX).default(20),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(KEYWORD_LIST_PAGE_SIZE_MAX)
        .default(KEYWORD_LIST_PAGE_SIZE_DEFAULT),
    engine: z.enum(RANK_ENGINES).optional(),
    search: z.string().trim().max(KEYWORD_PHRASE_MAX).optional()
        .transform((value) => value || undefined),
}).superRefine((value, ctx) => {
    if (value.cursor !== undefined && value.page !== undefined) ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['page'], message: 'ranks.errors.unknownCursor',
    });
});
export type ListKeywordsQuery = z.infer<typeof listKeywordsQuerySchema>;
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const keywordMarketMoveSchema = z.object({
    token: z.string().regex(/^[0-9a-f]{64}$/, 'validation.issue.invalidString'),
});
export const keywordIdParamsSchema = z.object({
    id: z.string().min(1),
});
export const cadencePatchSchema = z.object({
    cadence: z.enum(RANK_CADENCES),
});
export type CadencePatchBody = z.infer<typeof cadencePatchSchema>;
export const historyQuerySchema = z.object({
    from: z
        .string()
        .datetime()
        .optional(),
    to: z
        .string()
        .datetime()
        .optional(),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
