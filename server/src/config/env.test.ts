/**
 * Coverage for the env zod schema in env.ts.
 *
 * The env singleton is materialized at process start, so we re-parse the
 * exported `envSchema` here to exercise defaults, coercions, the
 * MASTER_ENCRYPTION_KEY decode refine, and the empty-string-as-unset handling
 * that docker-compose's `${VAR:-}` produces. Secrets are read from the root
 * .env only — there is no `_FILE` resolver to test (removed; see env.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { envSchema, validateAiProviderBaseUrls } from './env.js';

const baseEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
  DATABASE_URL: 'postgres://rankme:rankme@127.0.0.1:5432/x',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  MASTER_ENCRYPTION_KEY: '0'.repeat(64),
};

describe('envSchema', () => {
  it.each([
    ['blank repository defaults to omitted beta', '   ', 'beta', true],
    ['https repository is accepted in GA', 'https://github.com/rankmefast/rankmefast', 'ga', true],
    ['http repository is rejected', 'http://github.com/rankmefast/rankmefast', 'beta', false],
  ])('%s', (_label, repository, stage, succeeds) => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      GITHUB_REPOSITORY_URL: repository,
      VITE_RELEASE_STAGE: stage,
    });
    expect(parsed.success).toBe(succeeds);
    if (parsed.success) {
      expect(parsed.data.VITE_RELEASE_STAGE).toBe(stage);
      expect(parsed.data.GITHUB_REPOSITORY_URL).toBe(
        repository.trim() === '' ? undefined : repository,
      );
    }
  });

  it('normalizes blank and invalid release stages to beta', () => {
    for (const stage of ['', 'preview', 'BETA']) {
      const parsed = envSchema.parse({ ...baseEnv, VITE_RELEASE_STAGE: stage });
      expect(parsed.VITE_RELEASE_STAGE).toBe('beta');
    }
  });

  it('treats a blank app URL as unset', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      APP_URL: '   ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.APP_URL).toBeUndefined();
    }
  });

  it('accepts an app subdomain on the public-site protocol', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      CLIENT_URL: 'https://example.com',
      APP_URL: 'https://app.example.com',
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['http://app.example.com', 'protocol'],
    ['https://unrelated.example.net', 'hostname'],
    ['https://app.example.com/dashboard', 'path'],
  ])('rejects an APP_URL with an invalid %s boundary', (APP_URL) => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      CLIENT_URL: 'https://example.com',
      APP_URL,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ['APP_URL'] }),
      );
    }
  });

  it('rejects an AI budget above the total content-analysis cost ceiling', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      CONTENT_ANALYSIS_AI_BUDGET_MICROS: '2000',
      CONTENT_ANALYSIS_COST_CEILING_MICROS: '1000',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ['CONTENT_ANALYSIS_AI_BUDGET_MICROS'] }),
      );
    }
  });

  it('accepts a valid 64-hex MASTER_ENCRYPTION_KEY', () => {
    const parsed = envSchema.safeParse(baseEnv);
    expect(parsed.success).toBe(true);
  });

  it('fails closed on every deterministic backend in production', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      NODE_ENV: 'production',
      EMAIL_TRANSPORT: 'fake',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      for (const key of [
        'PROVIDER_AUDIT',
        'PROVIDER_RANK',
        'PROVIDER_KEYWORD',
        'PROVIDER_BACKLINK',
        'PROVIDER_COMPETITOR',
        'PROVIDER_LOCAL_LISTINGS',
        'PROVIDER_PAGESPEED',
        'PROVIDER_GSC',
        'PROVIDER_GA4',
        'PROVIDER_SUMMARY',
        'PROVIDER_AI_VISIBILITY',
        'PROVIDER_CONTENT_ANALYSIS',
        'PROVIDER_REVIEWS',
        'PROVIDER_TRENDS',
        'PROVIDER_APP_DATA',
        'PROVIDER_CONTENT_SOURCE',
        'PROVIDER_AI',
        'EMAIL_TRANSPORT',
      ]) {
        expect(paths).toContain(key);
      }
    }
  });

  it('permits an explicit production fake-provider test/demo seam', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      NODE_ENV: 'production',
      ALLOW_FAKE_PROVIDERS: 'true',
      EMAIL_TRANSPORT: 'fake',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ALLOW_FAKE_PROVIDERS).toBe(true);
  });

  it('does not classify a configured live transport as a fake production backend', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      EMAIL_TRANSPORT: 'resend',
      NODE_ENV: 'production',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).not.toContainEqual(
        expect.objectContaining({
          message:
            'EMAIL_TRANSPORT=fake is forbidden in production unless ALLOW_FAKE_PROVIDERS=true',
        }),
      );
    }
  });

  it('gates the E2E email capture behind the explicit fake-provider pair', () => {
    const safe = envSchema.safeParse({
      ...baseEnv,
      ALLOW_FAKE_PROVIDERS: 'true',
      EMAIL_TRANSPORT: 'fake',
      E2E_EMAIL_CAPTURE: 'true',
    });
    expect(safe.success).toBe(true);
    if (safe.success) expect(safe.data.E2E_EMAIL_CAPTURE).toBe(true);

    for (const input of [
      { ALLOW_FAKE_PROVIDERS: 'false', EMAIL_TRANSPORT: 'fake' },
      { ALLOW_FAKE_PROVIDERS: 'true', EMAIL_TRANSPORT: 'resend' },
    ] as const) {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        ...input,
        E2E_EMAIL_CAPTURE: 'true',
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({ path: ['E2E_EMAIL_CAPTURE'] }),
        );
      }
    }
  });

  it('defaults app data to fake and rejects unknown selectors', () => {
    const defaults = envSchema.parse(baseEnv);
    expect(defaults.PROVIDER_APP_DATA).toBe('fake');
    expect(
      envSchema.safeParse({ ...baseEnv, PROVIDER_APP_DATA: 'bogus' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...baseEnv, PROVIDER_APP_DATA: 'dataforseo' }).success,
    ).toBe(true);
  });

  it('treats blank optional superadmin credentials as unset and validates configured values', () => {
    for (const value of ['', '   ']) {
      const blank = envSchema.safeParse({
        ...baseEnv,
        SUPERADMIN_EMAIL: value,
        SUPERADMIN_PASSWORD: value,
      });
      expect(blank.success).toBe(true);
      if (blank.success) {
        expect(blank.data.SUPERADMIN_EMAIL).toBeUndefined();
        expect(blank.data.SUPERADMIN_PASSWORD).toBeUndefined();
      }
    }

    const configured = envSchema.safeParse({
      ...baseEnv,
      SUPERADMIN_EMAIL: 'owner@example.com',
      SUPERADMIN_PASSWORD: 'a-secure-bootstrap-password',
    });
    expect(configured.success).toBe(true);
    if (configured.success) {
      expect(configured.data.SUPERADMIN_EMAIL).toBe('owner@example.com');
      expect(configured.data.SUPERADMIN_PASSWORD).toBe('a-secure-bootstrap-password');
    }

    expect(
      envSchema.safeParse({
        ...baseEnv,
        SUPERADMIN_EMAIL: 'not-an-email',
        SUPERADMIN_PASSWORD: 'short',
      }).success,
    ).toBe(false);
  });

  it('rejects a MASTER_ENCRYPTION_KEY that decodes to fewer than 32 bytes', () => {
    const parsed = envSchema.safeParse({ ...baseEnv, MASTER_ENCRYPTION_KEY: 'x' });
    expect(parsed.success).toBe(false);
  });

  // CODEBASE-REVIEW §4.4 — PG_POOL_MAX defaults to 10 and coerces numeric
  // strings so `.env` `PG_POOL_MAX=20` still parses through zod.
  it('PG_POOL_MAX defaults to 10 when unset', () => {
    const parsed = envSchema.safeParse(baseEnv);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.PG_POOL_MAX).toBe(10);
  });

  it('caps standard SERP collection at the sold top-100 boundary', () => {
    const accepted = envSchema.safeParse({ ...baseEnv, SERP_DEPTH: '100' });
    expect(accepted.success).toBe(true);
    if (accepted.success) expect(accepted.data.SERP_DEPTH).toBe(100);
    expect(
      envSchema.safeParse({ ...baseEnv, SERP_DEPTH: '101' }).success,
    ).toBe(false);
  });

  it('PROVIDER_LOCAL_LISTINGS defaults to fake and accepts dataforseo', () => {
    const defaulted = envSchema.safeParse(baseEnv);
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data.PROVIDER_LOCAL_LISTINGS).toBe('fake');

    const live = envSchema.safeParse({ ...baseEnv, PROVIDER_LOCAL_LISTINGS: 'dataforseo' });
    expect(live.success).toBe(true);
    if (live.success) expect(live.data.PROVIDER_LOCAL_LISTINGS).toBe('dataforseo');
  });

  it('PageSpeed accepts both live vendors and caps additional samples at three', () => {
    const defaulted = envSchema.safeParse(baseEnv);
    expect(defaulted.success).toBe(true);
    if (defaulted.success) {
      expect(defaulted.data.PROVIDER_PAGESPEED).toBe('fake');
      expect(defaulted.data.PAGESPEED_SAMPLE_SIZE).toBe(3);
    }

    for (const provider of ['dataforseo', 'google'] as const) {
      const live = envSchema.safeParse({
        ...baseEnv,
        PROVIDER_PAGESPEED: provider,
        PAGESPEED_SAMPLE_SIZE: '3',
      });
      expect(live.success).toBe(true);
      if (live.success) expect(live.data.PROVIDER_PAGESPEED).toBe(provider);
    }

    expect(
      envSchema.safeParse({ ...baseEnv, PAGESPEED_SAMPLE_SIZE: '4' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...baseEnv, PROVIDER_PAGESPEED: 'unknown' }).success,
    ).toBe(false);
  });

  it.each(['PROVIDER_CONTENT_ANALYSIS', 'PROVIDER_REVIEWS'] as const)(
    '%s defaults to fake, accepts dataforseo, rejects unknown (spec 01a)',
    (key) => {
      const defaulted = envSchema.safeParse(baseEnv);
      expect(defaulted.success).toBe(true);
      if (defaulted.success) expect(defaulted.data[key]).toBe('fake');

      const live = envSchema.safeParse({ ...baseEnv, [key]: 'dataforseo' });
      expect(live.success).toBe(true);
      if (live.success) expect(live.data[key]).toBe('dataforseo');

      expect(envSchema.safeParse({ ...baseEnv, [key]: 'bogus' }).success).toBe(false);
    },
  );

  it('content source defaults to fake and live selection requires HTTPS Cloud configuration', () => {
    const fake = envSchema.safeParse(baseEnv);
    expect(fake.success).toBe(true);
    if (fake.success) expect(fake.data.PROVIDER_CONTENT_SOURCE).toBe('fake');

    expect(envSchema.safeParse({ ...baseEnv, PROVIDER_CONTENT_SOURCE: 'firecrawl' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        PROVIDER_CONTENT_SOURCE: 'firecrawl',
        FIRECRAWL_API_KEY: 'test-key',
        FIRECRAWL_BASE_URL: 'http://api.example.test',
      }).success,
    ).toBe(false);
    for (const unsupported of [
      'https://self-host.example',
      'https://user:secret@api.firecrawl.dev',
      'https://api.firecrawl.dev/v2',
      'https://api.firecrawl.dev?mode=custom',
    ]) {
      expect(
        envSchema.safeParse({
          ...baseEnv,
          PROVIDER_CONTENT_SOURCE: 'firecrawl',
          FIRECRAWL_API_KEY: 'test-key',
          FIRECRAWL_BASE_URL: unsupported,
        }).success,
      ).toBe(false);
    }
    const live = envSchema.safeParse({
      ...baseEnv,
      PROVIDER_CONTENT_SOURCE: 'firecrawl',
      FIRECRAWL_API_KEY: 'test-key',
      FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev',
      FIRECRAWL_ZDR_ENABLED: 'true',
      // Live monitoring is on by default, so the explicit binding is required.
      FIRECRAWL_WEBHOOK_SECRET_BINDINGS: JSON.stringify([
        { credential: 'primary', secrets: ['whsec_test'] },
      ]),
    });
    expect(live.success).toBe(true);
    if (live.success) {
      expect(live.data.FIRECRAWL_TIMEOUT_MS).toBe(60_000);
      expect(live.data.FIRECRAWL_ZDR_ENABLED).toBe(true);
      expect(live.data.FIRECRAWL_FALLBACK_API_KEYS).toEqual([]);
    }
  });

  it('parses ordered, trimmed Firecrawl fallback keys and treats a wholly blank value as empty', () => {
    const ordered = envSchema.safeParse({
      ...baseEnv,
      FIRECRAWL_API_KEY: ' primary-key ',
      FIRECRAWL_FALLBACK_API_KEYS: ' fallback-a, fallback-b ,fallback-c ',
    });
    expect(ordered.success).toBe(true);
    if (ordered.success) {
      expect(ordered.data.FIRECRAWL_API_KEY).toBe('primary-key');
      expect(ordered.data.FIRECRAWL_FALLBACK_API_KEYS).toEqual([
        'fallback-a',
        'fallback-b',
        'fallback-c',
      ]);
    }

    for (const value of [undefined, '', '   ']) {
      const blank = envSchema.safeParse({ ...baseEnv, FIRECRAWL_FALLBACK_API_KEYS: value });
      expect(blank.success).toBe(true);
      if (blank.success) expect(blank.data.FIRECRAWL_FALLBACK_API_KEYS).toEqual([]);
    }
  });

  it.each(['fallback-a,', ',fallback-a', 'fallback-a,,fallback-b'])(
    'rejects blank Firecrawl fallback key members in %s',
    (fallbacks) => {
      expect(
        envSchema.safeParse({ ...baseEnv, FIRECRAWL_FALLBACK_API_KEYS: fallbacks }).success,
      ).toBe(false);
    },
  );

  it('rejects duplicate Firecrawl fallback keys, including the primary key', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        FIRECRAWL_FALLBACK_API_KEYS: 'fallback-a, fallback-a',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        FIRECRAWL_API_KEY: 'primary-key',
        FIRECRAWL_FALLBACK_API_KEYS: 'fallback-a, primary-key',
      }).success,
    ).toBe(false);
  });

  it('caps Firecrawl fallback keys at five', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        FIRECRAWL_FALLBACK_API_KEYS: 'one,two,three,four,five',
      }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        FIRECRAWL_FALLBACK_API_KEYS: 'one,two,three,four,five,six',
      }).success,
    ).toBe(false);
  });

  it('firecrawl live requires an explicit primary webhook binding when monitoring is on', () => {
    const liveBase = {
      ...baseEnv,
      PROVIDER_CONTENT_SOURCE: 'firecrawl' as const,
      FIRECRAWL_API_KEY: 'test-key',
      FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev',
      FIRECRAWL_ZDR_ENABLED: 'true' as const,
    };
    // No binding + monitoring on (default) → rejected.
    const missing = envSchema.safeParse(liveBase);
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(
        missing.error.issues.some(
          (issue) =>
            issue.path[0] === 'FIRECRAWL_WEBHOOK_SECRET_BINDINGS' &&
            /explicit webhook-secret binding/.test(issue.message),
        ),
      ).toBe(true);
    }
    // Legacy unbound values cannot authorize the webhook after migration.
    expect(
      envSchema.safeParse({ ...liveBase, FIRECRAWL_WEBHOOK_SECRET: 's' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...liveBase, FIRECRAWL_WEBHOOK_SECRETS: 'a,b' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...liveBase,
        FIRECRAWL_WEBHOOK_SECRET_BINDINGS: JSON.stringify([
          { credential: 'primary', secrets: ['current', 'previous'] },
        ]),
      }).success,
    ).toBe(true);
    // Monitoring disabled → no webhook binding required.
    expect(
      envSchema.safeParse({ ...liveBase, CONTENT_MONITORING_ENABLED: 'false' }).success,
    ).toBe(true);
  });

  it('rejects malformed and duplicate Firecrawl webhook bindings', () => {
    const malformed = envSchema.safeParse({
      ...baseEnv,
      FIRECRAWL_WEBHOOK_SECRET_BINDINGS: '{',
    });
    expect(malformed.success).toBe(false);
    if (!malformed.success) {
      expect(malformed.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'FIRECRAWL_WEBHOOK_SECRET_BINDINGS must be valid JSON',
        }),
      );
    }

    const duplicateCredentials = envSchema.safeParse({
      ...baseEnv,
      FIRECRAWL_WEBHOOK_SECRET_BINDINGS: [
        { credential: 'primary', secrets: ['first-secret'] },
        { credential: 'primary', secrets: ['second-secret'] },
      ],
    });
    expect(duplicateCredentials.success).toBe(false);
    if (!duplicateCredentials.success) {
      expect(duplicateCredentials.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'each credential may appear in only one binding',
        }),
      );
    }
  });

  it('requires exact, globally unique bindings for every live Firecrawl credential', () => {
    const liveWithFallback = {
      ...baseEnv,
      PROVIDER_CONTENT_SOURCE: 'firecrawl' as const,
      FIRECRAWL_API_KEY: 'primary-key',
      FIRECRAWL_FALLBACK_API_KEYS: 'fallback-key',
      FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev',
      FIRECRAWL_ZDR_ENABLED: 'true' as const,
    };

    expect(
      envSchema.safeParse({
        ...liveWithFallback,
        FIRECRAWL_WEBHOOK_SECRET_BINDINGS: JSON.stringify([
          { credential: 'primary', secrets: ['account-one'] },
        ]),
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...liveWithFallback,
        FIRECRAWL_WEBHOOK_SECRET_BINDINGS: JSON.stringify([
          { credential: 'primary', secrets: ['shared'] },
          { credential: 'fallback:0', secrets: ['shared'] },
        ]),
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...liveWithFallback,
        FIRECRAWL_WEBHOOK_SECRET_BINDINGS: JSON.stringify([
          { credential: 'primary', secrets: ['account-one'] },
          { credential: 'fallback:1', secrets: ['account-two'] },
        ]),
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...liveWithFallback,
        FIRECRAWL_WEBHOOK_SECRET_BINDINGS: JSON.stringify([
          { credential: 'primary', secrets: ['account-one', 'account-one-old'] },
          { credential: 'fallback:0', secrets: ['account-two'] },
        ]),
      }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...liveWithFallback,
        CONTENT_MONITORING_ENABLED: 'false',
      }).success,
    ).toBe(true);
  });

  it('firecrawl live requires the FIRECRAWL_ZDR_ENABLED operator attestation', () => {
    const withoutAttestation = envSchema.safeParse({
      ...baseEnv,
      PROVIDER_CONTENT_SOURCE: 'firecrawl',
      FIRECRAWL_API_KEY: 'test-key',
      FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev',
    });
    expect(withoutAttestation.success).toBe(false);
    if (!withoutAttestation.success) {
      expect(
        withoutAttestation.error.issues.some(
          (issue) =>
            issue.path[0] === 'FIRECRAWL_ZDR_ENABLED' &&
            /FIRECRAWL_ZDR_ENABLED must be "true"/.test(issue.message),
        ),
      ).toBe(true);
    }

    // Explicit "false" is refused with the same message — the booleanString
    // parser accepts only the literals 'true' | 'false', which prevents a
    // truthiness bug from ever routing 'false' → true.
    const explicitFalse = envSchema.safeParse({
      ...baseEnv,
      PROVIDER_CONTENT_SOURCE: 'firecrawl',
      FIRECRAWL_API_KEY: 'test-key',
      FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev',
      FIRECRAWL_ZDR_ENABLED: 'false',
    });
    expect(explicitFalse.success).toBe(false);

    // Fake selection does not require the attestation — self-host / dev stays
    // keyless and boots without any Firecrawl configuration.
    expect(
      envSchema.safeParse({ ...baseEnv, PROVIDER_CONTENT_SOURCE: 'fake' }).success,
    ).toBe(true);
  });

  it('treats empty Firecrawl credentials, base URL, and webhook secrets as unset', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      FIRECRAWL_API_KEY: '',
      FIRECRAWL_FALLBACK_API_KEYS: '',
      FIRECRAWL_BASE_URL: '',
      FIRECRAWL_WEBHOOK_SECRET: '',
      FIRECRAWL_WEBHOOK_SECRETS: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.FIRECRAWL_API_KEY).toBeUndefined();
      expect(parsed.data.FIRECRAWL_FALLBACK_API_KEYS).toEqual([]);
      expect(parsed.data.FIRECRAWL_BASE_URL).toBeUndefined();
      expect(parsed.data.FIRECRAWL_WEBHOOK_SECRET).toBeUndefined();
      expect(parsed.data.FIRECRAWL_WEBHOOK_SECRETS).toEqual([]);
      expect(parsed.data.FIRECRAWL_WEBHOOK_SECRET_BINDINGS).toEqual([]);
    }
  });

  it('rejects a legacy Firecrawl webhook secret repeated in its rotation list', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      FIRECRAWL_WEBHOOK_SECRET: 'same-secret',
      FIRECRAWL_WEBHOOK_SECRETS: 'same-secret',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ['FIRECRAWL_WEBHOOK_SECRETS'] }),
      );
    }
  });

  it('centrally parses bounded unique legacy Firecrawl secret lists', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      FIRECRAWL_WEBHOOK_SECRETS: 'one, two',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.FIRECRAWL_WEBHOOK_SECRETS).toEqual(['one', 'two']);
    }

    expect(
      envSchema.safeParse({ ...baseEnv, FIRECRAWL_WEBHOOK_SECRETS: 'same,same' }).success,
    ).toBe(false);
    for (const malformed of ['one,,two', ',one', 'one,']) {
      expect(
        envSchema.safeParse({ ...baseEnv, FIRECRAWL_WEBHOOK_SECRETS: malformed }).success,
      ).toBe(false);
    }
    expect(
      envSchema.safeParse({
        ...baseEnv,
        FIRECRAWL_WEBHOOK_SECRETS: Array.from({ length: 13 }, (_, index) => `s${index}`).join(','),
      }).success,
    ).toBe(false);
  });

  it('defaults the AI runtime to a keyless fake with the locked unique order', () => {
    const parsed = envSchema.safeParse(baseEnv);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PROVIDER_AI).toBe('fake');
      expect(parsed.data.AI_PROVIDER_ORDER).toEqual([
        'glm',
        'deepseek',
        'kimi',
        'openai',
        'google',
        'anthropic',
      ]);
      expect(parsed.data.AI_TELEMETRY_ENABLED).toBe(false);
    }
  });

  it('supports fake, legacy Anthropic, and ordered AI SDK summary startup modes', () => {
    const fake = envSchema.safeParse({
      ...baseEnv,
      AI_SUMMARY_ENABLED: 'true',
      PROVIDER_SUMMARY: 'fake',
    });
    expect(fake.success).toBe(true);

    const legacyMissingRates = envSchema.safeParse({
      ...baseEnv,
      AI_SUMMARY_ENABLED: 'true',
      PROVIDER_SUMMARY: 'anthropic',
      ANTHROPIC_API_KEY: 'synthetic-key',
    });
    expect(legacyMissingRates.success).toBe(false);
    const legacy = envSchema.safeParse({
      ...baseEnv,
      AI_SUMMARY_ENABLED: 'true',
      PROVIDER_SUMMARY: 'anthropic',
      ANTHROPIC_API_KEY: 'synthetic-key',
      ANTHROPIC_INPUT_COST_MICROS_PER_MILLION: '1',
      ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION: '1',
    });
    expect(legacy.success).toBe(true);

    expect(envSchema.safeParse({
      ...baseEnv,
      AI_SUMMARY_ENABLED: 'true',
      PROVIDER_SUMMARY: 'ai-sdk',
    }).success).toBe(false);
    const ordered = envSchema.safeParse({
      ...baseEnv,
      AI_SUMMARY_ENABLED: 'true',
      PROVIDER_SUMMARY: 'ai-sdk',
      PROVIDER_AI: 'ai-sdk',
      AI_PROVIDER_ORDER: 'openai',
      AI_MAX_ATTEMPTS: '1',
      OPENAI_ENABLED: 'true',
      OPENAI_API_KEY: 'synthetic-key',
      OPENAI_MODEL: 'operator-model',
      OPENAI_INPUT_COST_MICROS_PER_MILLION: '1',
      OPENAI_OUTPUT_COST_MICROS_PER_MILLION: '1',
    });
    expect(ordered.success).toBe(true);
    expect(envSchema.safeParse({ ...baseEnv, PROVIDER_SUMMARY: 'unknown' }).success).toBe(false);
  });

  it('rejects duplicate, unknown, empty, and attempt-longer-than-order AI configuration', () => {
    for (const value of ['glm,glm', 'glm,other', 'glm,,openai', '']) {
      expect(
        envSchema.safeParse({
          ...baseEnv,
          AI_PROVIDER_ORDER: value,
          AI_MAX_ATTEMPTS: '1',
        }).success,
      ).toBe(false);
    }
    expect(
      envSchema.safeParse({
        ...baseEnv,
        AI_PROVIDER_ORDER: 'glm,openai',
        AI_MAX_ATTEMPTS: '3',
      }).success,
    ).toBe(false);
  });

  it('requires live credentials, model, rates, endpoint, and one enabled ordered provider', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        PROVIDER_AI: 'ai-sdk',
        AI_PROVIDER_ORDER: 'glm',
        AI_MAX_ATTEMPTS: '1',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        PROVIDER_AI: 'ai-sdk',
        AI_PROVIDER_ORDER: 'glm',
        AI_MAX_ATTEMPTS: '1',
        GLM_ENABLED: 'true',
      }).success,
    ).toBe(false);
    const live = envSchema.safeParse({
      ...baseEnv,
      PROVIDER_AI: 'ai-sdk',
      AI_PROVIDER_ORDER: 'glm',
      AI_MAX_ATTEMPTS: '1',
      GLM_ENABLED: 'true',
      GLM_API_KEY: 'test-key',
      GLM_MODEL: 'configured-model',
      GLM_BASE_URL: 'https://glm.example.test/v1',
      GLM_INPUT_COST_MICROS_PER_MILLION: '100',
      GLM_OUTPUT_COST_MICROS_PER_MILLION: '200',
    });
    expect(live.success).toBe(true);
  });

  it('skips disabled providers deterministically without requiring their credentials', () => {
    const parsed = envSchema.safeParse({
      ...baseEnv,
      PROVIDER_AI: 'ai-sdk',
      AI_PROVIDER_ORDER: 'glm,openai',
      AI_MAX_ATTEMPTS: '2',
      GLM_ENABLED: 'false',
      OPENAI_ENABLED: 'true',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'configured-model',
      OPENAI_INPUT_COST_MICROS_PER_MILLION: '100',
      OPENAI_OUTPUT_COST_MICROS_PER_MILLION: '200',
    });
    expect(parsed.success).toBe(true);
  });

  it('treats empty optional AI credentials, models, and GLM endpoint as unset', () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      GLM_API_KEY: '',
      GLM_MODEL: '',
      GLM_BASE_URL: '',
    });
    expect(parsed.GLM_API_KEY).toBeUndefined();
    expect(parsed.GLM_MODEL).toBeUndefined();
    expect(parsed.GLM_BASE_URL).toBeUndefined();
  });

  it.each([
    ['AI_TOTAL_TIMEOUT_MS', '0'],
    ['AI_TOTAL_TIMEOUT_MS', '300001'],
    ['AI_MAX_ATTEMPTS', '0'],
    ['AI_MAX_ATTEMPTS', '7'],
    ['AI_ACCOUNT_SPEND_WINDOW_MS', '59999'],
    ['AI_ACCOUNT_SPEND_LIMIT_MICROS', '0'],
    ['AI_USAGE_RETENTION_DAYS', '3651'],
    ['OPENAI_INPUT_COST_MICROS_PER_MILLION', '-1'],
    ['OPENAI_OUTPUT_COST_MICROS_PER_MILLION', '1000000001'],
  ])('rejects out-of-range %s=%s', (key, value) => {
    expect(envSchema.safeParse({ ...baseEnv, [key]: value }).success).toBe(false);
  });

  it('SEC-URL rejects a private GLM resolution and HTTP outside test', async () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      PROVIDER_AI: 'ai-sdk',
      AI_PROVIDER_ORDER: 'glm',
      AI_MAX_ATTEMPTS: '1',
      GLM_ENABLED: 'true',
      GLM_API_KEY: 'test-key',
      GLM_MODEL: 'configured-model',
      GLM_BASE_URL: 'https://glm.example.test/v1',
      GLM_INPUT_COST_MICROS_PER_MILLION: '100',
      GLM_OUTPUT_COST_MICROS_PER_MILLION: '200',
    });
    await expect(
      validateAiProviderBaseUrls(parsed, async () => [
        { address: '169.254.169.254', family: 4 },
      ]),
    ).rejects.toThrow(/not publicly routable/);

    await expect(
      validateAiProviderBaseUrls(
        { ...parsed, NODE_ENV: 'production', GLM_BASE_URL: 'http://glm.example.test/v1' },
        async () => [{ address: '8.8.8.8', family: 4 }],
      ),
    ).rejects.toThrow(/scheme/);
  });

  it('SEC-URL accepts a public test endpoint and no-ops when GLM is not selected', async () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      PROVIDER_AI: 'ai-sdk',
      AI_PROVIDER_ORDER: 'glm',
      AI_MAX_ATTEMPTS: '1',
      GLM_ENABLED: 'true',
      GLM_API_KEY: 'test-key',
      GLM_MODEL: 'configured-model',
      GLM_BASE_URL: 'http://glm.example.test/v1',
      GLM_INPUT_COST_MICROS_PER_MILLION: '100',
      GLM_OUTPUT_COST_MICROS_PER_MILLION: '200',
    });
    await expect(
      validateAiProviderBaseUrls(parsed, async () => [{ address: '8.8.8.8', family: 4 }]),
    ).resolves.toBeUndefined();
    await expect(
      validateAiProviderBaseUrls({ ...parsed, PROVIDER_AI: 'fake' }),
    ).resolves.toBeUndefined();
  });

  it('SEC-URL validates a literal public GLM address with the default resolver path', async () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      PROVIDER_AI: 'ai-sdk',
      AI_PROVIDER_ORDER: 'glm',
      AI_MAX_ATTEMPTS: '1',
      GLM_ENABLED: 'true',
      GLM_API_KEY: 'test-key',
      GLM_MODEL: 'configured-model',
      GLM_BASE_URL: 'https://8.8.8.8/v1',
      GLM_INPUT_COST_MICROS_PER_MILLION: '100',
      GLM_OUTPUT_COST_MICROS_PER_MILLION: '200',
    });
    await expect(validateAiProviderBaseUrls(parsed)).resolves.toBeUndefined();
  });

  it('PG_POOL_MAX coerces the string value from the env source', () => {
    const parsed = envSchema.safeParse({ ...baseEnv, PG_POOL_MAX: '32' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.PG_POOL_MAX).toBe(32);
  });

  it('PG_POOL_MAX rejects a non-positive value', () => {
    const parsed = envSchema.safeParse({ ...baseEnv, PG_POOL_MAX: '0' });
    expect(parsed.success).toBe(false);
  });

  // docker-compose forwards `${ALERT_WEBHOOK_URL:-}` → "" when unset; an empty
  // string must be treated as unset, not rejected by `.url()` (would crash boot).
  it('ALERT_WEBHOOK_URL treats an empty string as unset and still validates a real URL', () => {
    const empty = envSchema.safeParse({ ...baseEnv, ALERT_WEBHOOK_URL: '' });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.ALERT_WEBHOOK_URL).toBeUndefined();

    const set = envSchema.safeParse({
      ...baseEnv,
      ALERT_WEBHOOK_URL: 'https://hooks.example.com/alert',
    });
    expect(set.success).toBe(true);
    if (set.success) expect(set.data.ALERT_WEBHOOK_URL).toBe('https://hooks.example.com/alert');

    const bad = envSchema.safeParse({ ...baseEnv, ALERT_WEBHOOK_URL: 'not-a-url' });
    expect(bad.success).toBe(false);
  });

  // Prompt 15 — Content Intelligence rollout flags. All default true and
  // accept the "true" / "false" literal strings that docker-compose forwards.
  it('Content Intelligence rollout flags default to true and toggle to false', () => {
    const defaults = envSchema.safeParse(baseEnv);
    expect(defaults.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.MCP_ENABLED).toBe(true);
      expect(defaults.data.CONTENT_INTELLIGENCE_ENABLED).toBe(true);
      expect(defaults.data.CONTENT_INVENTORY_ENABLED).toBe(true);
      expect(defaults.data.COMPETITOR_CONTENT_INTELLIGENCE_ENABLED).toBe(true);
      expect(defaults.data.CONTENT_MONITORING_ENABLED).toBe(true);
    }

    const off = envSchema.safeParse({
      ...baseEnv,
      MCP_ENABLED: 'false',
      CONTENT_INTELLIGENCE_ENABLED: 'false',
      CONTENT_INVENTORY_ENABLED: 'false',
      COMPETITOR_CONTENT_INTELLIGENCE_ENABLED: 'false',
      CONTENT_MONITORING_ENABLED: 'false',
    });
    expect(off.success).toBe(true);
    if (off.success) {
      expect(off.data.MCP_ENABLED).toBe(false);
      expect(off.data.CONTENT_INTELLIGENCE_ENABLED).toBe(false);
      expect(off.data.CONTENT_INVENTORY_ENABLED).toBe(false);
      expect(off.data.COMPETITOR_CONTENT_INTELLIGENCE_ENABLED).toBe(false);
      expect(off.data.CONTENT_MONITORING_ENABLED).toBe(false);
    }

    // Anything other than "true" / "false" is a hard schema error.
    const bad = envSchema.safeParse({
      ...baseEnv,
      CONTENT_INTELLIGENCE_ENABLED: 'yes',
    });
    expect(bad.success).toBe(false);
  });

  // ------------------------------------------------------------------
  // rankme-ai-chat-mcp 01 — AI Assistant env seams. CHAT_ENABLED mirrors
  // MCP_ENABLED (strict 'true'|'false' string, default true); the chat knobs
  // default and coerce; the pack id + rate bucket parse with and without.
  // ------------------------------------------------------------------
  it('CHAT_ENABLED defaults true, toggles false, rejects junk', () => {
    const defaults = envSchema.safeParse(baseEnv);
    expect(defaults.success).toBe(true);
    if (defaults.success) expect(defaults.data.CHAT_ENABLED).toBe(true);

    const off = envSchema.safeParse({ ...baseEnv, CHAT_ENABLED: 'false' });
    expect(off.success).toBe(true);
    if (off.success) expect(off.data.CHAT_ENABLED).toBe(false);

    const on = envSchema.safeParse({ ...baseEnv, CHAT_ENABLED: 'true' });
    expect(on.success).toBe(true);
    if (on.success) expect(on.data.CHAT_ENABLED).toBe(true);

    const bad = envSchema.safeParse({ ...baseEnv, CHAT_ENABLED: 'yes' });
    expect(bad.success).toBe(false);
  });

  it('AI chat knobs default, coerce overrides, and reject out-of-range values', () => {
    const defaults = envSchema.safeParse(baseEnv);
    expect(defaults.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.AI_CHAT_MAX_OUTPUT_TOKENS).toBe(2_048);
      expect(defaults.data.AI_CHAT_TOTAL_TIMEOUT_MS).toBe(120_000);
      expect(defaults.data.AI_CHAT_MAX_STEPS).toBe(5);
      expect(defaults.data.RATE_LIMIT_CHAT_WINDOW_MS).toBe(60_000);
      expect(defaults.data.RATE_LIMIT_CHAT_MAX).toBe(20);
    }

    const overridden = envSchema.safeParse({
      ...baseEnv,
      AI_CHAT_MAX_OUTPUT_TOKENS: '4096',
      AI_CHAT_TOTAL_TIMEOUT_MS: '60000',
      AI_CHAT_MAX_STEPS: '3',
      RATE_LIMIT_CHAT_WINDOW_MS: '30000',
      RATE_LIMIT_CHAT_MAX: '10',
    });
    expect(overridden.success).toBe(true);
    if (overridden.success) {
      expect(overridden.data.AI_CHAT_MAX_OUTPUT_TOKENS).toBe(4_096);
      expect(overridden.data.AI_CHAT_TOTAL_TIMEOUT_MS).toBe(60_000);
      expect(overridden.data.AI_CHAT_MAX_STEPS).toBe(3);
      expect(overridden.data.RATE_LIMIT_CHAT_WINDOW_MS).toBe(30_000);
      expect(overridden.data.RATE_LIMIT_CHAT_MAX).toBe(10);
    }

    for (const bad of [
      { AI_CHAT_MAX_OUTPUT_TOKENS: '0' },
      { AI_CHAT_MAX_OUTPUT_TOKENS: '100000' },
      { AI_CHAT_TOTAL_TIMEOUT_MS: '500' },
      { AI_CHAT_MAX_STEPS: '-1' },
      { RATE_LIMIT_CHAT_WINDOW_MS: '0' },
      { RATE_LIMIT_CHAT_MAX: '-5' },
    ]) {
      const parsed = envSchema.safeParse({ ...baseEnv, ...bad });
      expect(parsed.success, `${JSON.stringify(bad)} must reject`).toBe(false);
    }
  });

  it('every rankme-ai-chat-mcp variable is declared in .env.example', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const example = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const vars = [
      'CHAT_ENABLED',
      'AI_CHAT_MAX_OUTPUT_TOKENS',
      'AI_CHAT_TOTAL_TIMEOUT_MS',
      'AI_CHAT_MAX_STEPS',
      'RATE_LIMIT_CHAT_WINDOW_MS',
      'RATE_LIMIT_CHAT_MAX',
    ];
    for (const name of vars) {
      expect(example.includes(name), `${name} missing from .env.example`).toBe(true);
    }
    // PROXY_STREAM_TIMEOUT_MS is web-container-only — documented in
    // .env.example + threaded through docker-compose web env, never in env.ts.
    expect(example.includes('PROXY_STREAM_TIMEOUT_MS')).toBe(true);
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(compose.includes('PROXY_STREAM_TIMEOUT_MS')).toBe(true);
  });

  // ------------------------------------------------------------------
  // rankme-semrush-parity kill switches (Prompt 00) — all default false;
  // strict 'true' | 'false' string parse; junk rejected.
  // ------------------------------------------------------------------
  const PARITY_FLAGS = [
    'BRAND_RADAR_ENABLED',
    'REVIEW_INTELLIGENCE_ENABLED',
    'LINK_INTELLIGENCE_ENABLED',
    'TRAFFIC_INSIGHTS_ENABLED',
    'KEYWORD_TRENDS_ENABLED',
  ] as const;

  it('rankme-semrush-parity kill switches default to false when unset', () => {
    const parsed = envSchema.safeParse(baseEnv);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      for (const flag of PARITY_FLAGS) {
        expect(parsed.data[flag]).toBe(false);
      }
    }
  });

  it('rankme-semrush-parity kill switches parse explicit "true" and "false"', () => {
    for (const flag of PARITY_FLAGS) {
      const on = envSchema.safeParse({ ...baseEnv, [flag]: 'true' });
      expect(on.success, `${flag}=true must parse`).toBe(true);
      if (on.success) expect(on.data[flag]).toBe(true);

      const off = envSchema.safeParse({ ...baseEnv, [flag]: 'false' });
      expect(off.success, `${flag}=false must parse`).toBe(true);
      if (off.success) expect(off.data[flag]).toBe(false);
    }
  });

  it('rankme-semrush-parity kill switches reject non-boolean strings', () => {
    for (const flag of PARITY_FLAGS) {
      for (const bad of ['yes', '1', 'TRUE', 'off', 'null']) {
        const parsed = envSchema.safeParse({ ...baseEnv, [flag]: bad });
        expect(parsed.success, `${flag}=${bad} must reject`).toBe(false);
      }
    }
  });

  it('Link Intelligence rate limits default, coerce overrides, and reject non-positive values', () => {
    const defaults = envSchema.safeParse(baseEnv);
    expect(defaults.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.RATE_LIMIT_LINK_INTEL_WINDOW_MS).toBe(60_000);
      expect(defaults.data.RATE_LIMIT_LINK_INTEL_MAX).toBe(30);
      expect(defaults.data.RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS).toBe(60_000);
      expect(defaults.data.RATE_LIMIT_LINK_INTEL_POLL_MAX).toBe(60);
    }

    const overridden = envSchema.safeParse({
      ...baseEnv,
      RATE_LIMIT_LINK_INTEL_WINDOW_MS: '120000',
      RATE_LIMIT_LINK_INTEL_MAX: '45',
      RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS: '180000',
      RATE_LIMIT_LINK_INTEL_POLL_MAX: '90',
    });
    expect(overridden.success).toBe(true);
    if (overridden.success) {
      expect(overridden.data.RATE_LIMIT_LINK_INTEL_WINDOW_MS).toBe(120_000);
      expect(overridden.data.RATE_LIMIT_LINK_INTEL_MAX).toBe(45);
      expect(overridden.data.RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS).toBe(180_000);
      expect(overridden.data.RATE_LIMIT_LINK_INTEL_POLL_MAX).toBe(90);
    }

    expect(envSchema.safeParse({
      ...baseEnv,
      RATE_LIMIT_LINK_INTEL_WINDOW_MS: '0',
    }).success).toBe(false);
    expect(envSchema.safeParse({
      ...baseEnv,
      RATE_LIMIT_LINK_INTEL_MAX: '-1',
    }).success).toBe(false);
    expect(envSchema.safeParse({
      ...baseEnv,
      RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS: '0',
    }).success).toBe(false);
    expect(envSchema.safeParse({
      ...baseEnv,
      RATE_LIMIT_LINK_INTEL_POLL_MAX: '-1',
    }).success).toBe(false);
  });

  it('Traffic Insights rate limits default, coerce overrides, and reject non-positive values', () => {
    const defaults = envSchema.safeParse(baseEnv);
    expect(defaults.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS).toBe(60_000);
      expect(defaults.data.RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX).toBe(10);
    }

    const overridden = envSchema.safeParse({
      ...baseEnv,
      RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS: '120000',
      RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX: '15',
    });
    expect(overridden.success).toBe(true);
    if (overridden.success) {
      expect(overridden.data.RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS).toBe(120_000);
      expect(overridden.data.RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX).toBe(15);
    }

    expect(
      envSchema.safeParse({
        ...baseEnv,
        RATE_LIMIT_TRAFFIC_SNAPSHOTS_WINDOW_MS: '0',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        RATE_LIMIT_TRAFFIC_SNAPSHOTS_MAX: '-1',
      }).success,
    ).toBe(false);
  });

  // ------------------------------------------------------------------
  // rankme-community-requests (Prompt 00) — twelve kill switches and four
  // per-run cost ceilings. Flags default false; ceilings are positive
  // integers with pinned defaults.
  // ------------------------------------------------------------------
  const COMMUNITY_FLAGS = [
    'SERP_FEATURE_TRACKING_ENABLED',
    'KEYWORD_CLUSTERING_ENABLED',
    'ALT_ENGINE_TRACKING_ENABLED',
    'CANNIBALIZATION_ENABLED',
    'TOXIC_LINKS_ENABLED',
    'ALERTS_ENABLED',
    'INTERNAL_LINKING_ENABLED',
    'CONTENT_BRIEFS_ENABLED',
    'GEOGRID_ENABLED',
    'SCHEMA_GENERATOR_ENABLED',
    'CLIENT_REPORTS_ENABLED',
    'PUBLIC_EXPORTS_ENABLED',
  ] as const;

  /**
   * Flags whose owning feature prompt has SHIPPED, so a runtime consumer is
   * expected. Each entry names the prompt that wired it. Every other flag
   * stays declared-only and is still guarded below.
   *
   *   SERP_FEATURE_TRACKING_ENABLED — prompt 01 (SERP feature capture).
   *   CANNIBALIZATION_ENABLED — prompt 04 (GSC cannibalization reports).
   *   TOXIC_LINKS_ENABLED — prompt 05 (toxicity review and disavow export).
   *   INTERNAL_LINKING_ENABLED — prompt 07 (stored-inventory link guidance).
   *   CONTENT_BRIEFS_ENABLED — prompt 08 (content briefs and editor).
   *   SCHEMA_GENERATOR_ENABLED — prompt 10 (schema generator routes and service).
   *   CLIENT_REPORTS_ENABLED — prompt 11 (client reports, schedules, portal).
   *   PUBLIC_EXPORTS_ENABLED — prompt 12 (CSV exports and public API docs).
   *   ALERTS_ENABLED — prompt 06 (alert rules, channels, dispatch).
   */
  const WIRED_COMMUNITY_FLAGS = new Set<string>([
    'SERP_FEATURE_TRACKING_ENABLED',
    'CANNIBALIZATION_ENABLED',
    // Spec 03 — Bing / YouTube / Amazon rank tracking ships in this change,
    // so the flag now has real consumers: the create-keyword gate
    // (`modules/ranks/keywords.service.ts`) and the sweep gate
    // (`modules/ranks/rank.processor.ts`).
    'ALT_ENGINE_TRACKING_ENABLED',
    'TOXIC_LINKS_ENABLED',
    'SCHEMA_GENERATOR_ENABLED',
    // Spec 06 — alert rules and channels ship in this change. Consumers: the
    // mutation gate (`modules/alerts/alerts.service.ts`) and the mount comment
    // in `app.ts`; stored rule/log reads deliberately survive a flag flip.
    'ALERTS_ENABLED',
    // Specs 07 and 08 ship their mutation gates and worker kill switches;
    // stored-run reads deliberately survive a later flag flip.
    'INTERNAL_LINKING_ENABLED',
    'CONTENT_BRIEFS_ENABLED',
    // Spec 09 — geogrid local rank tracking ships in this change. Consumers:
    // the preview/create gate (`modules/geogrid/geogrid.service.ts`) and the
    // `geogrid-scan` worker kill switch (`worker.ts`); stored-scan reads
    // deliberately survive a later flag flip.
    'GEOGRID_ENABLED',
    // Specs 11 and 12 ship their own-infra report/export read surfaces and
    // mutation gates. Stored report management and existing public reads
    // deliberately survive a later flag flip.
    'CLIENT_REPORTS_ENABLED',
    'PUBLIC_EXPORTS_ENABLED',
    // Spec 02 — SERP-overlap clustering ships in this change. Consumers:
    // the preview/create gate (`modules/keyword-clusters/keyword-clusters.service.ts`)
    // and the `keyword-clustering` worker kill switch (`worker.ts`); stored-run
    // reads deliberately survive a later flag flip.
    'KEYWORD_CLUSTERING_ENABLED',
  ]);

  const COMMUNITY_CEILINGS = [
    ['CONTENT_BRIEF_COST_CEILING_MICROS', 120_000],
    ['INTERNAL_LINKING_COST_CEILING_MICROS', 12_000],
    ['TOXICITY_COST_CEILING_MICROS', 30_000],
    ['SCHEMA_GEN_COST_CEILING_MICROS', 6_000],
  ] as const;

  it('rankme-community-requests kill switches default to false when unset', () => {
    const parsed = envSchema.safeParse(baseEnv);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      for (const flag of COMMUNITY_FLAGS) {
        expect(parsed.data[flag], `${flag} must default false`).toBe(false);
      }
    }
  });

  it('rankme-community-requests kill switches parse explicit "true" and "false"', () => {
    for (const flag of COMMUNITY_FLAGS) {
      const on = envSchema.safeParse({ ...baseEnv, [flag]: 'true' });
      expect(on.success, `${flag}=true must parse`).toBe(true);
      if (on.success) expect(on.data[flag]).toBe(true);

      const off = envSchema.safeParse({ ...baseEnv, [flag]: 'false' });
      expect(off.success, `${flag}=false must parse`).toBe(true);
      if (off.success) expect(off.data[flag]).toBe(false);
    }
  });

  it('rankme-community-requests kill switches reject non-boolean strings', () => {
    for (const flag of COMMUNITY_FLAGS) {
      for (const bad of ['yes', '1', 'TRUE', 'off', 'null', '']) {
        const parsed = envSchema.safeParse({ ...baseEnv, [flag]: bad });
        expect(parsed.success, `${flag}=${bad} must reject`).toBe(false);
      }
    }
  });

  it('rankme-community-requests cost ceilings default to the pinned micros', () => {
    const parsed = envSchema.safeParse(baseEnv);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      for (const [key, value] of COMMUNITY_CEILINGS) {
        expect(parsed.data[key], `${key} default`).toBe(value);
      }
    }
  });

  it('rankme-community-requests cost ceilings coerce positive integer strings', () => {
    for (const [key] of COMMUNITY_CEILINGS) {
      const parsed = envSchema.safeParse({ ...baseEnv, [key]: '999999' });
      expect(parsed.success, `${key}=999999 must parse`).toBe(true);
      if (parsed.success) expect(parsed.data[key]).toBe(999_999);
    }
  });

  it('rankme-community-requests cost ceilings reject zero, negative and non-integer values', () => {
    for (const [key] of COMMUNITY_CEILINGS) {
      for (const bad of ['0', '-1', '2.5', 'abc']) {
        const parsed = envSchema.safeParse({ ...baseEnv, [key]: bad });
        expect(parsed.success, `${key}=${bad} must reject`).toBe(false);
      }
    }
  });

  it('every rankme-community-requests variable is declared in .env.example', () => {
    // The env schema and `.env.example` must move in the same change
    // (environment-variables rule). CLAUDE.md §4 parity is covered by
    // docs-consistency.
    const repoRoot = path.resolve(__dirname, '../../..');
    const example = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const declared = [
      ...COMMUNITY_FLAGS,
      ...COMMUNITY_CEILINGS.map(([key]) => key),
    ];
    expect(declared).toHaveLength(16);
    for (const key of declared) {
      expect(example.includes(`${key}=`), `${key} missing from .env.example`).toBe(true);
    }
  });

  it('rankme-community-requests flags gain a runtime consumer only once their prompt ships', () => {
    // Prompt 00 DECLARES the seams; the owning feature prompt wires each one
    // and moves it into `WIRED_COMMUNITY_FLAGS` in the same change. Anything
    // reading a STILL-DECLARED-ONLY `env.<FLAG>` outside the schema, the
    // read-only superadmin surface, and this suite is scope creep — fail
    // loudly.
    const serverSrc = path.resolve(__dirname, '..');
    const allowed = new Set([
      path.join(serverSrc, 'config/env.ts'),
      path.join(serverSrc, 'config/env.test.ts'),
      path.join(serverSrc, 'modules/superadmin-intelligence/intelligence.service.ts'),
      path.join(serverSrc, 'modules/superadmin-intelligence/intelligence.test.ts'),
    ]);
    const offenders: string[] = [];
    const wiredSeen = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (allowed.has(full)) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const flag of COMMUNITY_FLAGS) {
          if (!source.includes(flag)) continue;
          if (WIRED_COMMUNITY_FLAGS.has(flag)) {
            wiredSeen.add(flag);
            continue;
          }
          offenders.push(`${path.relative(serverSrc, full)}:${flag}`);
        }
      }
    };
    walk(serverSrc);
    expect(offenders, `Unexpected consumers of the declared-only flags: ${offenders.join(', ')}`).toEqual([]);
    // The allowlist must never hide a flag that lost its consumer: a wired
    // flag with nothing reading it means the feature booted dark.
    expect([...wiredSeen].sort()).toEqual([...WIRED_COMMUNITY_FLAGS].sort());
  });
});
