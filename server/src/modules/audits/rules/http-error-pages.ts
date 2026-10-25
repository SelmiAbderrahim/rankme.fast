/**
 * Rule `http-error-pages` — crawled addresses that answered with an error.
 * Server errors (5xx) are listed first, then client errors (4xx). Fix-now,
 * critical: visitors and search engines who follow a link land on an error.
 *
 * Refusals (401, 403, 429) are often bot protection that turns the crawler
 * away while visitors get the page. When every error is a refusal the finding
 * drops to watch (warning) and says so in `meta.refusalsOnly`, the same
 * caution `broken-internal-links` applies to inconclusive re-checks.
 */
import type { AuditPage, AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'http-error-pages' as const;

/** Statuses that mean "you may not", which bot protection also answers. */
export const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

export const httpErrorPagesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const errors = result.pages
      .filter((page) => page.statusCode >= 400)
      .sort((a: AuditPage, b: AuditPage) => b.statusCode - a.statusCode || a.url.localeCompare(b.url));
    if (errors.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('critical', true), severity: 'critical', affectedUrls: [] };
    }
    const refusalsOnly = errors.every((page) => REFUSAL_STATUSES.has(page.statusCode));
    const severity = refusalsOnly ? 'warning' : 'critical';
    return {
      ruleId: RULE_ID,
      bucket: bucketFor(severity, false),
      severity,
      affectedUrls: errors.map((page) => page.url),
      meta: {
        ...boundedEvidence(
          errors.map((page) => ({ url: page.url, statusCode: page.statusCode })),
          'pages',
        ),
        serverErrors: errors.filter((page) => page.statusCode >= 500).length,
        clientErrors: errors.filter((page) => page.statusCode < 500).length,
        ...(refusalsOnly ? { refusalsOnly: true } : {}),
      },
    };
  },
};
