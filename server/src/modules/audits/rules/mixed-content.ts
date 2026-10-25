/**
 * Rule `mixed-content` — HTTPS pages that link to plain HTTP addresses.
 * Browsers warn about insecure targets and the link leaks visitors off the
 * secure site. With the resource scan, HTTP images, scripts and
 * stylesheets those pages load are listed as well. Watch, warning.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { MAX_EVIDENCE_ROWS, evaluatePageChecks, servedIndexable } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'mixed-content' as const;

export const mixedContentRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['insecureLinks'],
      scope: (page) => servedIndexable(page) && page.url.startsWith('https://'),
      extraMeta: (audit, flagged) => {
        const urls = new Set(flagged.map((page) => page.url));
        const insecure = (audit.resources ?? [])
          .filter((resource) => resource.url.startsWith('http://') && resource.usedOn.some((url) => urls.has(url)))
          .map((resource) => resource.url);
        return insecure.length > 0 ? { insecureResources: insecure.slice(0, MAX_EVIDENCE_ROWS) } : {};
      },
    });
  },
};
