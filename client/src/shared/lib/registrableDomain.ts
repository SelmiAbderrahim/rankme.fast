/**
 * Registrable-domain (eTLD+1) rules shared by every module that must decide
 * whether two hostnames belong to the same owner.
 *
 * The reduction is a deliberately small public-suffix-lite: it keeps the
 * label directly under a known multi-part or platform suffix, otherwise the
 * last two labels. Lookalikes never collapse onto the real domain, because the
 * comparison is on whole labels: `notexample.com`, `myexample.com` and
 * `example.com.evil.net` all reduce to something other than `example.com`.
 *
 * This is the client mirror of `server/src/shared/utils/registrable-domain.ts`;
 * the server re-validates every submission. Both copies are pinned by the same
 * fixture table in their unit tests, so the lists cannot drift silently.
 */

const MULTI_PART_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  // Country-code second-level suffixes.
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'co.nz',
  'net.nz',
  'org.nz',
  'com.br',
  'co.za',
  'com.mx',
  'com.tr',
  'co.in',
  'com.sg',
  'com.hk',
  'com.cn',
  'com.tw',
  'co.kr',
  'com.ar',
  'com.co',
  'com.pe',
  'com.ua',
  'com.sa',
  'com.eg',
  'com.ng',
  'com.my',
  'com.ph',
  'com.pk',
  'com.vn',
  'co.id',
  'co.il',
  // Hosting platforms where every customer label is its own site.
  'github.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'herokuapp.com',
  'web.app',
  'firebaseapp.com',
  'blogspot.com',
]);

/** Deterministic public-suffix-lite eTLD+1 key for a hostname. */
export function registrableDomainKey(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.+$/, '');
  const labels = normalized.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const suffix = labels.slice(-2).join('.');
  return MULTI_PART_PUBLIC_SUFFIXES.has(suffix)
    ? labels.slice(-3).join('.')
    : suffix;
}

/**
 * Hostname of a site given its stored `domain` or `url`. Accepts a bare host,
 * an origin, or a full URL, and returns `''` when nothing usable is present.
 */
export function hostnameOf(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * True when `candidate` (a hostname, origin, or URL) sits on the same
 * registrable domain as `owned`: the domain itself, its `www.` form, or any
 * subdomain. Empty or unparseable inputs are never "the same".
 */
export function isSameRegistrableDomain(candidate: string, owned: string): boolean {
  const a = registrableDomainKey(hostnameOf(candidate));
  const b = registrableDomainKey(hostnameOf(owned));
  return a.length > 0 && a === b;
}
