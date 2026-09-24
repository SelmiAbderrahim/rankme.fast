import { z } from 'zod';
import { validateSiteUrl } from '@features/sites';

export const LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH = 253;
export const BACKLINK_BULK_RANK_MAX_DOMAINS = 100;
export const LINK_GAP_MIN_COMPETITORS = 1;
export const LINK_GAP_MAX_COMPETITORS = 3;

export const backlinkDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH + 16)
  .transform((raw, context) => {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = validateSiteUrl(candidate);
    if (!parsed.ok || parsed.domain.length > LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid' });
      return z.NEVER;
    }
    return parsed.domain.toLowerCase().replace(/^www\./, '');
  });

export const bulkRankDomainsSchema = z
  .string()
  .transform((value) => value.split(/[\n,]+/).map((domain) => domain.trim()).filter(Boolean))
  .pipe(z.array(backlinkDomainSchema).min(1).max(BACKLINK_BULK_RANK_MAX_DOMAINS))
  .transform((domains, context) => {
    const unique = [...new Set(domains)];
    if (unique.length !== domains.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate' });
      return z.NEVER;
    }
    return unique;
  });

const linkGapCompetitorsSchema = z
  .array(z.string().trim())
  .transform((competitors) => competitors.filter(Boolean))
  .pipe(
    z
      .array(backlinkDomainSchema)
      .min(LINK_GAP_MIN_COMPETITORS, 'atLeastOne')
      .max(LINK_GAP_MAX_COMPETITORS, 'tooMany'),
  )
  .transform((competitors) => [...new Set(competitors)]);

/** Client mirror only; the server repeats ownership and domain validation. */
export const linkGapFormSchema = z
  .object({
    ownDomain: backlinkDomainSchema,
    competitors: linkGapCompetitorsSchema,
  })
  .superRefine((value, context) => {
    if (value.competitors.includes(value.ownDomain)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ownAmongCompetitors',
        path: ['competitors'],
      });
    }
  });

export type LinkGapFormValues = z.infer<typeof linkGapFormSchema>;

export function splitGapCompetitors(value: string): string[] {
  return value.split(/[\n,]+/).map((domain) => domain.trim()).filter(Boolean);
}
