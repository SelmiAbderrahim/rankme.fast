import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { CONTENT_BRIEF_MAX_DRAFT_CHARS, CONTENT_BRIEF_STATUSES, } from './content-brief.model.js';
export const CONTENT_BRIEF_KEYWORD_MAX_CHARS = 200;
export function normalizeBriefKeyword(value: string): string {
    return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}
const keywordSchema = z
    .string()
    .min(1)
    .max(CONTENT_BRIEF_KEYWORD_MAX_CHARS)
    .transform(normalizeBriefKeyword)
    .pipe(z.string().min(1).max(CONTENT_BRIEF_KEYWORD_MAX_CHARS));
const clientKeySchema = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/);
export const contentBriefPreviewBodySchema = z
    .object({
    keyword: keywordSchema,
    locale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export const contentBriefCreateBodySchema = contentBriefPreviewBodySchema.extend({
    clientKey: clientKeySchema.optional(),
});
export const contentBriefListQuerySchema = z
    .object({
    status: z.union([z.literal('all'), z.enum(CONTENT_BRIEF_STATUSES)]).default('all'),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
})
    .strict();
export const contentBriefIdParamSchema = z
    .object({ briefId: z.string().regex(/^[0-9a-f]{24}$/) })
    .strict();
export const contentBriefSiteParamSchema = z
    .object({ siteId: z.string().regex(/^[0-9a-f]{24}$/) })
    .strict();
export const contentBriefPathParamsSchema = z
    .object({
    siteId: z.string().regex(/^[0-9a-f]{24}$/),
    briefId: z.string().regex(/^[0-9a-f]{24}$/),
})
    .strict();
export const contentBriefDraftBodySchema = z
    .object({
    draft: z.string().min(1).max(CONTENT_BRIEF_MAX_DRAFT_CHARS),
    locale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export type ContentBriefPreviewBody = z.infer<typeof contentBriefPreviewBodySchema>;
export type ContentBriefCreateBody = z.infer<typeof contentBriefCreateBodySchema>;
export type ContentBriefListQuery = z.infer<typeof contentBriefListQuerySchema>;
export type ContentBriefDraftBody = z.infer<typeof contentBriefDraftBodySchema>;
