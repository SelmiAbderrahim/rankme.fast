import { createHash } from 'node:crypto';
export const FIRECRAWL_CREDENTIAL_REF_PATTERN = /^fc-cred-v1:[0-9a-f]{64}$/;
const CREDENTIAL_REF_DOMAIN = 'rankme.fast:firecrawl-credential-ref:v1\0';
/** Stable, one-way affinity reference shared by the provider and webhook. */
export function firecrawlCredentialRef(apiKey: string): string {
    const normalized = apiKey.trim();
    if (normalized === '')
        throw new Error('Firecrawl API key must not be empty.');
    const digest = createHash('sha256')
        .update(CREDENTIAL_REF_DOMAIN)
        .update(normalized)
        .digest('hex');
    return `fc-cred-v1:${digest}`;
}
