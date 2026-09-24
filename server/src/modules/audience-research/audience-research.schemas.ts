/**
 * Zod validators for audience research inputs.
 *
 * Reused by the API routes and by the model boundary. All string
 * fields are trimmed and Unicode-normalized; control characters and
 * markup-only values are rejected; case-insensitive dedupe of seed topics.
 * Private URL seeds and non-HTTP schemes are rejected at the trust boundary.
 */
import { z } from 'zod';
import { siteMarketSchema } from '../../shared/observations/observations.js';
import { assertPublicUrlSyntaxSafe } from '../../shared/security/url-safety.js';
export const SEED_TOPIC_MIN = 2;
export const SEED_TOPIC_MAX = 160;
export const MAX_SEED_TOPICS = 10;
export const MAX_COMPETITOR_DOMAINS = 5;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const MARKUP_ONLY_RE = /^[\s<>/"'&;=]*$/;
const HTML_MARKER_RE = /<[a-zA-Z!]/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const URL_LIKE_RE = /^[a-z][a-z\d+.-]*:\/\//i;
function normalizeTopic(v: string): string {
    return v.normalize('NFKC').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const seedTopicSchema = z
    .string()
    .max(SEED_TOPIC_MAX * 4)
    .superRefine((raw, ctx) => {
    if (CONTROL_CHAR_RE.test(raw)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidString' });
    }
})
    .transform((v) => normalizeTopic(v))
    .superRefine((v, ctx) => {
    if (v.length < SEED_TOPIC_MIN) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.custom' });
        return;
    }
    if (v.length > SEED_TOPIC_MAX) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.custom' });
        return;
    }
    if (HTML_MARKER_RE.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidString' });
        return;
    }
    if (MARKUP_ONLY_RE.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidString' });
        return;
    }
    if (URL_LIKE_RE.test(v)) {
        try {
            // Seed URLs are query text rather than fetch targets, so retain the
            // existing HTTP-or-HTTPS input contract while sharing every pure check
            // with the server-side SSRF authority.
            assertPublicUrlSyntaxSafe(v, { allowHttp: true });
        }
        catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidUrl' });
        }
    }
});
const competitorDomainSchema = z
    .string()
    .max(255)
    .transform((v) => v.trim().toLowerCase().replace(/\.+$/, ''))
    .superRefine((v, ctx) => {
    if (v.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.required' });
        return;
    }
    if (v.startsWith('http://') || v.startsWith('https://')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidString' });
        return;
    }
    try {
        assertPublicUrlSyntaxSafe(`https://${v}`);
    }
    catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidString' });
        return;
    }
    if (!DOMAIN_RE.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidString' });
    }
});
function dedupeIgnoreCase(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        const key = v.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}
export const audienceResearchInputSchema = z
    .object({
    siteMarket: siteMarketSchema,
    competitorDomains: z
        .array(competitorDomainSchema)
        .max(MAX_COMPETITOR_DOMAINS)
        .default([])
        .transform(dedupeIgnoreCase),
    seedTopics: z
        .array(seedTopicSchema)
        .max(MAX_SEED_TOPICS)
        .default([])
        .transform(dedupeIgnoreCase),
})
    .strict();
export type AudienceResearchInput = z.infer<typeof audienceResearchInputSchema>;
