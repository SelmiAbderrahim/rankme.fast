import { z } from 'zod';
import { SERP_DEVICES, RANK_CADENCES, RANK_ENGINES } from '../../db/schema/keywords.js';
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
        .max(300, 'ranks.errors.phraseTooLong'),
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
export const createKeywordSchema = createKeywordFields.superRefine((value, ctx) => {
    if (value.engine === 'youtube' || value.engine === 'amazon') {
        if (value.engineTarget === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['engineTarget'],
                message: 'ranks.errors.engineTargetRequired',
            });
            return;
        }
        const pattern = value.engine === 'youtube' ? YOUTUBE_HANDLE_RE : AMAZON_ASIN_RE;
        if (!pattern.test(value.engineTarget)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['engineTarget'],
                message: value.engine === 'youtube'
                    ? 'ranks.errors.youtubeHandleInvalid'
                    : 'ranks.errors.amazonAsinInvalid',
            });
        }
        return;
    }
    if (value.engineTarget !== undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['engineTarget'],
            message: 'ranks.errors.engineTargetNotAllowed',
        });
    }
});
export type CreateKeywordBody = z.infer<typeof createKeywordSchema>;
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
    limit: z.coerce.number().int().min(1).max(100).default(20),
    engine: z.enum(RANK_ENGINES).optional(),
});
export type ListKeywordsQuery = z.infer<typeof listKeywordsQuerySchema>;
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
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
