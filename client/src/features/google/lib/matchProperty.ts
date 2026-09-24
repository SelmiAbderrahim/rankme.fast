import type { GscProperty } from '../types';

/**
 * Whether a single GSC property covers a site domain — mirror of the server
 * logic in `modules/google-connections/google-connections.service.ts`:
 * `sc-domain:` by exact domain, `url-prefix` by hostname equality.
 */
export function propertyCoversDomain(
  domain: string,
  propertyUrl: string,
): boolean {
  if (propertyUrl === `sc-domain:${domain}`) return true;
  try {
    return new URL(propertyUrl).hostname === domain;
  } catch {
    return false;
  }
}

/**
 * Match a site domain to a verified GSC property. `sc-domain:` beats
 * `url-prefix` when both match (broader coverage). Returns null when no
 * property covers the domain.
 */
export function matchPropertyForDomain(
  domain: string,
  properties: readonly GscProperty[],
): GscProperty | null {
  const domainMatch = properties.find(
    (p) => p.siteUrl === `sc-domain:${domain}`,
  );
  if (domainMatch) return domainMatch;
  const prefixMatch = properties.find((p) =>
    propertyCoversDomain(domain, p.siteUrl),
  );
  return prefixMatch ?? null;
}
