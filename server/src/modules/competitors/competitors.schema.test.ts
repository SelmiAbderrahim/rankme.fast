import { describe, expect, it } from 'vitest';
import { intersectionQuerySchema, techStackParamsSchema } from './competitors.schema.js';

describe('competitor domain request validation', () => {
  it.each([
    ['intersection', intersectionQuerySchema, 'competitor'],
    ['technology stack', techStackParamsSchema, 'domain'],
  ] as const)('%s distinguishes a missing domain from a malformed value', (_name, schema, key) => {
    const missing = schema.safeParse(key === 'domain' ? { siteId: 'site-1' } : {});
    expect(missing.success).toBe(false);
    if (missing.success) return;
    expect(missing.error.issues[0]?.path).toEqual([key]);

    const malformed = schema.safeParse(
      key === 'domain' ? { siteId: 'site-1', domain: 12 } : { competitor: 12 },
    );
    expect(malformed.success).toBe(false);
    if (malformed.success) return;
    expect(malformed.error.issues[0]?.message).toBe('competitors.errors.competitorRequired');
  });
});
