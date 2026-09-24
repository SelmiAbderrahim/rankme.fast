import { z } from 'zod';
import { BACKLINK_BULK_RANK_MAX_DOMAINS, BACKLINK_HISTORY_MAX_MONTHS, BACKLINK_PULL_MAX_ROWS, LINK_GAP_MAX_COMPETITORS, } from './backlink-runs.model.js';
import { backlinkDeepDomainSchema } from './backlink-deep.schema.js';
function boundedLimit(maximum: number, fallback: number) {
    return z.coerce
        .number()
        .finite()
        .int()
        .transform((value) => Math.min(maximum, Math.max(1, value)))
        .default(fallback);
}
const rowPreviewSchema = (type: 'refDomains' | 'anchors') => z
    .object({
    type: z.literal(type),
    domain: backlinkDeepDomainSchema,
    limit: boundedLimit(BACKLINK_PULL_MAX_ROWS, BACKLINK_PULL_MAX_ROWS),
})
    .strict();
const historyPreviewSchema = z
    .object({
    type: z.literal('history'),
    domain: backlinkDeepDomainSchema,
    limit: boundedLimit(BACKLINK_HISTORY_MAX_MONTHS, BACKLINK_HISTORY_MAX_MONTHS),
})
    .strict();
const bulkRanksDomainsPreviewSchema = z
    .object({
    type: z.literal('bulkRanks'),
    domains: z
        .array(backlinkDeepDomainSchema)
        .min(1)
        .transform((domains) => [...new Set(domains)].slice(0, BACKLINK_BULK_RANK_MAX_DOMAINS)),
})
    .strict();
// The singular form keeps the prompt's `{ type, domain, limit? }` primitive
// useful for a one-domain bulk-rank preview; the client may send `domains`
// when previewing the full bulk form.
const bulkRanksDomainPreviewSchema = z
    .object({
    type: z.literal('bulkRanks'),
    domain: backlinkDeepDomainSchema,
})
    .strict()
    .transform((input) => ({ type: input.type, domains: [input.domain] }));
export const backlinkDeepPreviewBodySchema = z.union([
    rowPreviewSchema('refDomains'),
    rowPreviewSchema('anchors'),
    historyPreviewSchema,
    bulkRanksDomainsPreviewSchema,
    bulkRanksDomainPreviewSchema,
]);
export const linkGapPreviewBodySchema = z
    .object({
    ownDomain: backlinkDeepDomainSchema,
    competitors: z
        .array(z.string().trim().min(1).max(269))
        .min(1)
        .max(LINK_GAP_MAX_COMPETITORS),
})
    .strict();
export type BacklinkDeepPreviewBody = z.infer<typeof backlinkDeepPreviewBodySchema>;
export type LinkGapPreviewBody = z.infer<typeof linkGapPreviewBodySchema>;
