# Log Redaction — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**The pino logger in `server/src/config/logger.ts` MUST redact every credential, session token, API key, cookie, and vendor secret that can appear in a structured log line. No secret reaches a log sink — disk, stdout, or external collector — in plaintext.**

Plural credential fields are equally secret. Redact the env string and every
runtime array/container name (`FIRECRAWL_FALLBACK_API_KEYS`, `apiKeys`,
`fallbackApiKeys`) as whole values; add explicit paths for deeper config and
common nested/wrapper and arbitrary array shapes. Derived
`credentialRef`/`providerCredentialRef` affinity values remain internal and are
redacted too.

## Architecture

pino's `redact.paths` use [jsonpath-ish](https://github.com/pinojs/pino/blob/main/docs/redaction.md) selectors. Both top-level (`authorization`) and nested (`req.headers.authorization`, `*.authorization`) paths must be listed — pino redaction is path-based, not key-based.

The canonical list lives in `server/src/config/logger.ts` → `redact.paths`. The machine-checked regression test lives in `server/src/config/logger.test.ts`.

## What MUST be on the redaction list

| Category | Paths (examples) |
|----------|-----------------|
| Request credentials | `authorization`, `*.authorization`, `req.headers.authorization`, `req.headers["authorization"]` |
| Cookies / sessions | `cookie`, `*.cookie`, `cookies`, `*.cookies`, `session_token`, `*.session_token` |
| OAuth tokens | `accessToken`, `*.accessToken`, `refreshToken`, `*.refreshToken` |
| API keys | `apiKey`, `*.apiKey`, `apiKeys`, `*.apiKeys`, `fallbackApiKeys`, `*.fallbackApiKeys`, `csrfToken`, `*.csrfToken` |
| Bootstrap creds | `SUPERADMIN_PASSWORD`, `*.SUPERADMIN_PASSWORD`, `password`, `*.password` |
| Env vendor secrets | `POLAR_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `DATAFORSEO_PASSWORD`, `MASTER_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY` + their `*.` nested variants |

## Correct pattern

```typescript
// config/logger.ts — every new env secret gets a top-level + nested path
export const logger = pino({
  redact: {
    paths: [
      'authorization', '*.authorization',
      'req.headers.authorization', 'req.headers["authorization"]',
      'NEW_VENDOR_SECRET', '*.NEW_VENDOR_SECRET',
      // ...
    ],
    censor: '[redacted]',
  },
});
```

## FORBIDDEN

```typescript
// WRONG — logging a request object without redaction coverage
logger.info({ req }, 'incoming request');
// if req.headers.authorization is not on the redaction list, the bearer
// token lands on disk in plaintext

// WRONG — logging the env object
logger.info({ env }, 'boot config');
// env.POLAR_ACCESS_TOKEN, env.ANTHROPIC_API_KEY, env.MASTER_ENCRYPTION_KEY
// all reach the sink unless every one is individually redacted

// WRONG — disabling redaction for "just this one debug line"
const debugLogger = pino({ level: 'debug' }); // no redact.paths
debugLogger.info({ refreshToken: token }, 'debug');
```

## Validation Checklist

- [ ] Every secret in `.env.example` has a matching `SECRET_NAME` + `*.SECRET_NAME` entry in `redact.paths`
- [ ] Request-borne credentials (`authorization`, `cookie`) have both top-level and `req.headers.*` paths
- [ ] The regression test in `server/src/config/logger.test.ts` asserts each category redacts to `[redacted]`
- [ ] No `pino()` call elsewhere in the codebase creates an unredacted logger that touches request or env data
- [ ] A new env secret triggers a redaction-path addition in the same PR
- [ ] A module that logs a new user-content field adds top-level and `*.`-nested field paths in the same change
