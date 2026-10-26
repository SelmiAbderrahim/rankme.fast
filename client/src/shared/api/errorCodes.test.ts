import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODE_ALIASES, canonicalApiErrorCode } from './errorCodes';

describe('client and server error-code parity', () => {
  it('mirrors every OSS server alias exactly', () => {
    const source = readFileSync(resolve(process.cwd(), '../server/src/shared/i18n/error-codes.ts'), 'utf8');
    const aliases = Object.fromEntries([...source.matchAll(/\s+([A-Z_]+): '([A-Z_]+)'/g)].map((match) => [match[1], match[2]]));
    expect(API_ERROR_CODE_ALIASES).toEqual(aliases);
    for (const [alias, canonical] of Object.entries(API_ERROR_CODE_ALIASES)) expect(canonicalApiErrorCode(alias)).toBe(canonical);
    expect(canonicalApiErrorCode('CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_OWN_SITE')).toBe('CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_OWN_SITE');
    expect(canonicalApiErrorCode('toString')).toBe('toString');
  });
});
