import { z } from 'zod';
import { BUSINESS_QUERY_MAX_CHARS, BUSINESS_QUERY_MIN_CHARS } from './local-business.model.js';
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export const keywordRankParamsSchema = siteIdParamsSchema.extend({
    keywordId: z.string().min(1),
});

// Business setup. Control characters are refused; the
// query is what the vendor sees, so it is trimmed and bounded here.
export const businessSearchBodySchema = z
    .object({
        query: z
            .string()
            .trim()
            .min(BUSINESS_QUERY_MIN_CHARS)
            .max(BUSINESS_QUERY_MAX_CHARS)
            .refine((value) => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)),
    })
    .strict();

export const businessSelectBodySchema = z
    .object({ candidateId: z.string().uuid() })
    .strict();
