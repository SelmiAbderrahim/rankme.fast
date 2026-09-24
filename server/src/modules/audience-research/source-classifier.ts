/**
 * Deterministic source-type classifier for audience research.
 *
 * Pure function: identical (host, path) input MUST return the identical
 * PublicPageSourceHint. AI never classifies. `other` is only assigned when no
 * higher-priority rule fires. This file is authoritative for the feature;
 * `PublicPageDiscoveryRow.sourceTypeHint` is a lightweight adapter hint that
 * this classifier deliberately overrides.
 */
import type { PublicPageSourceHint } from '../../shared/providers/types.js';
/**
 * Public-suffix-lite: two-part TLDs that this project cares about at
 * registrable-domain granularity. `subdomain.example.co.uk` → `example.co.uk`.
 * Anything else is treated as a single-part TLD so `www.reddit.com` collapses
 * to `reddit.com` and `blog.example.com` collapses to `example.com`.
 * Kept intentionally small — full PSL parsing lives elsewhere.
 */
const MULTI_PART_TLDS: ReadonlySet<string> = new Set([
    'co.uk',
    'com.au',
    'co.jp',
    'co.nz',
    'com.br',
    'co.za',
    'com.mx',
    'com.tr',
    'co.in',
    'com.sg',
    'com.hk',
]);
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/\.+$/, '');
}
/**
 * Best-effort registrable domain (eTLD+1). Preserves IPv4 literals and hosts
 * containing IPv6 colons. Deterministic; identical input → identical output.
 */
export function registrableDomain(host: string): string {
    const h = normalizeHost(host);
    if (h.length === 0)
        return '';
    if (h.includes(':'))
        return h;
    if (IPV4_RE.test(h))
        return h;
    const parts = h.split('.').filter((p) => p.length > 0);
    if (parts.length <= 2)
        return parts.join('.');
    const last2 = parts.slice(-2).join('.');
    if (MULTI_PART_TLDS.has(last2)) {
        return parts.slice(-3).join('.');
    }
    return last2;
}
function normalizePath(path: string): string {
    const trimmed = path.trim();
    if (trimmed.length === 0)
        return '/';
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withSlash.toLowerCase();
}
const FORUM_HOSTS: ReadonlySet<string> = new Set([
    'reddit.com',
    'stackoverflow.com',
]);
const REVIEW_HOSTS: ReadonlySet<string> = new Set([
    'g2.com',
    'capterra.com',
    'trustpilot.com',
]);
const QUESTION_HOSTS: ReadonlySet<string> = new Set([
    'quora.com',
    'stackexchange.com',
]);
function hostStartsWith(host: string, prefix: string): boolean {
    return host === prefix || host.startsWith(`${prefix}.`);
}
export function classifySourceType(host: string, path: string): PublicPageSourceHint {
    const h = normalizeHost(host);
    const p = normalizePath(path);
    const registrable = registrableDomain(h);
    if (FORUM_HOSTS.has(registrable))
        return 'forum';
    if (hostStartsWith(h, 'discourse') || hostStartsWith(h, 'forum'))
        return 'forum';
    if (p.startsWith('/community/'))
        return 'forum';
    if (QUESTION_HOSTS.has(registrable))
        return 'question';
    if (hostStartsWith(h, 'answers'))
        return 'question';
    if (p.startsWith('/questions/'))
        return 'question';
    if (REVIEW_HOSTS.has(registrable))
        return 'review';
    if (/(^|[/-])review/.test(p))
        return 'review';
    if (/(^|\/)vs(\/|$)/.test(p) ||
        p.includes('-vs-') ||
        p.includes('/compare/') ||
        p.includes('alternatives')) {
        return 'comparison';
    }
    return 'other';
}
