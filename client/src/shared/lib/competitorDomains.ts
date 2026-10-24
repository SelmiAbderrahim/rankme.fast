import type { PhraseNormalization } from '@shared/hooks/usePhraseChipsInput';

export const COMPETITOR_DOMAINS_MAX = 3;
export const COMPETITOR_DOMAIN_MAX_LENGTH = 253;
const DOMAIN_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
export type CompetitorDomainRejection = 'invalid' | 'own';

/** Normalize to the same host identity used by the OSS server's own-site guard. */
export function toCompetitorDomain(raw: string): string | null {
  const value = raw.trim();
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
    return DOMAIN_PATTERN.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function competitorDomainNormalizer(ownDomain?: string): (phrase: string) => PhraseNormalization {
  const own = ownDomain ? toCompetitorDomain(ownDomain) : null;
  return (phrase) => {
    const domain = toCompetitorDomain(phrase);
    if (domain === null) return { rejected: 'invalid' satisfies CompetitorDomainRejection };
    if (domain === own) return { rejected: 'own' satisfies CompetitorDomainRejection };
    return { value: domain };
  };
}
