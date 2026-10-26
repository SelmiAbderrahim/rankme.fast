/**
 * Explainable "suspected spam" signals for a page of backlinks.
 *
 * Deterministic and offline: it reads only fields the list already carries
 * (referring URL, the provider's spam score) and never calls a vendor. Each
 * signal is a plain reason code the UI renders as a localized sentence. A row
 * is only labelled `suspected` when the evidence is strong enough to review:
 * the provider's own high spam score, or two independent patterns. One pattern
 * alone (a dated slug on a news site, a shop-like domain name) is not enough.
 *
 * This is a review aid, not a verdict. The result always carries
 * `verified: false`, and the product copy says "suspected, not verified".
 * Nothing here is sent to Google or used to disavow a link by itself.
 */
import { hostnameOf, registrableDomainKey } from '../../shared/utils/registrable-domain.js';

export const LINK_SUSPICION_REASONS = [
  'vendor_spam_score',
  'dated_numbered_path',
  'shared_path_template',
  'lookalike_domain',
] as const;
export type LinkSuspicionReason = (typeof LINK_SUSPICION_REASONS)[number];

export interface LinkSuspicion {
  status: 'suspected';
  /** Always false: a heuristic flag is never proof of harm. */
  verified: false;
  reasons: LinkSuspicionReason[];
}

export interface SuspicionInput {
  urlFrom: string;
  backlinkSpamScore?: number | null | undefined;
}

/** Same threshold the toxicity rubric treats as a toxic vendor score. */
export const VENDOR_SPAM_SCORE_SUSPECT_AT = 60;
/** Referrers on distinct registrable domains that must share one path template. */
export const SHARED_TEMPLATE_MIN_DOMAINS = 3;
/** Digit groups a path template needs before sharing it is meaningful. */
export const SHARED_TEMPLATE_MIN_DIGIT_GROUPS = 3;

/** `2026-07-24-247`: a calendar date followed by a running counter. */
const DATED_COUNTER_SEGMENT = /(?:^|\/)(?:19|20)\d{2}-\d{2}-\d{2}-\d+(?:\/|$)/;
const COMMERCE_KEYWORD =
  /(official|outlet|discount|cheap|sale|replica|clearance|wholesale|store|shop)/;
const LOW_TRUST_TLDS: ReadonlySet<string> = new Set([
  'us', 'top', 'xyz', 'shop', 'site', 'online', 'icu', 'cc', 'club', 'vip',
  'buzz', 'cfd', 'sbs', 'click', 'store', 'live', 'life', 'fun', 'work',
]);

function pathOf(urlFrom: string): string {
  try {
    return new URL(urlFrom).pathname.toLowerCase();
  } catch {
    return '';
  }
}

/** `/list/2026-07-24-247` -> `/list/#-#-#-#`: the shape shared by templated pages. */
export function pathTemplate(path: string): string {
  return path.replace(/\d+/g, '#');
}

function digitGroups(template: string): number {
  return (template.match(/#/g) ?? []).length;
}

/** A hyphenated brand-plus-commerce name on a low-trust TLD (`brand-officialsites.us`). */
export function isLookalikeDomain(host: string): boolean {
  const registrable = registrableDomainKey(host);
  const dot = registrable.lastIndexOf('.');
  if (dot <= 0) return false;
  const label = registrable.slice(0, dot);
  const tld = registrable.slice(dot + 1);
  return label.includes('-') && COMMERCE_KEYWORD.test(label) && LOW_TRUST_TLDS.has(tld);
}

/**
 * Assess one page of rows. Returns one entry per input row, `null` when the
 * row shows nothing worth a review. Cross-row patterns only see this page.
 */
export function assessLinkSuspicion(
  rows: readonly SuspicionInput[],
): Array<LinkSuspicion | null> {
  const templates = rows.map((row) => pathTemplate(pathOf(row.urlFrom)));
  const domainsByTemplate = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    const template = templates[index]!;
    if (digitGroups(template) < SHARED_TEMPLATE_MIN_DIGIT_GROUPS) return;
    const domains = domainsByTemplate.get(template) ?? new Set<string>();
    domains.add(registrableDomainKey(hostnameOf(row.urlFrom)));
    domainsByTemplate.set(template, domains);
  });

  return rows.map((row, index) => {
    const reasons: LinkSuspicionReason[] = [];
    if ((row.backlinkSpamScore ?? 0) >= VENDOR_SPAM_SCORE_SUSPECT_AT) {
      reasons.push('vendor_spam_score');
    }
    if (DATED_COUNTER_SEGMENT.test(pathOf(row.urlFrom))) {
      reasons.push('dated_numbered_path');
    }
    if ((domainsByTemplate.get(templates[index]!)?.size ?? 0) >= SHARED_TEMPLATE_MIN_DOMAINS) {
      reasons.push('shared_path_template');
    }
    if (isLookalikeDomain(hostnameOf(row.urlFrom))) {
      reasons.push('lookalike_domain');
    }
    const suspected =
      reasons.includes('vendor_spam_score') || reasons.length >= 2;
    return suspected ? { status: 'suspected', verified: false, reasons } : null;
  });
}
