# Security Threat Model

## Status

Living security specification. The registers below map each trust boundary and control to its single shared authority and the tests that prove it. New code may tighten a control but may not bypass or reimplement it.

## Threat and trust-boundary register

| Boundary | Untrusted principal | STRIDE categories | Required controls | Owner | Identifiers |
|---|---|---|---|---|---|
| Crawled or competitor HTML → AI model | Public page author, compromised site, malicious competitor | Spoofing, tampering, information disclosure, elevation of privilege | Treat bounded sanitized text as delimited data; never retain raw HTML; validate every citation against application-issued canonical source IDs; render output as inert text; reject substantial competitor copying | 01, 02, 05, 09 | SEC-BOUND, SEC-INJECT, SEC-OUT, SEC-CITATION, SEC-COPYRIGHT |
| Firecrawl webhook → API | Forged sender, replay attacker, abusive customer | Spoofing, tampering, repudiation, denial of service, elevation of privilege | Verify the exact raw body before parsing; constant-time signature comparison; bounded replay window and durable dedupe; bounded body and batch; named per-IP bucket; validate callback URLs through the URL authority | 10 | SEC-WEBHOOK, SEC-BOUND, SEC-RATE, SEC-URL |
| MCP JSON-RPC → API | Invalid API-key holder, compromised MCP client, abusive customer | Spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege | Existing `rmf_` key authentication; account-scoped reads with cross-account 404; bounded requests and batches; named per-token/IP bucket; per-item capacity accounting before spend; recursive output scan | 12 | SEC-MCP-AUTH, SEC-DENY, SEC-BOUND, SEC-RATE, SEC-SPEND |
| Public SSR guides and marketing → browser | Malicious translation/content contributor, crafted route caller | Tampering, information disclosure, denial of service, elevation of privilege | Escaped JSON-LD serializer; visible-content/schema parity; strict known-route 404; inert React text; vetted outbound URL schemes | 13, 14, 16 | SEC-OUT, SEC-SSR-ROUTE |
| Superadmin control plane → operator | Compromised operator session, malicious tenant content | Spoofing, repudiation, information disclosure, elevation of privilege | Step-up re-authentication; explicit DTO allowlists; recursive output scan; no secret values; append-only tamper-evident audit events | 11 | SEC-ADMIN, SEC-DENY, SEC-SECRET |
| Export payload → spreadsheet software | Tenant-controlled cell text | Tampering, elevation of privilege | Neutralize formula-leading cells before RFC-4180 encoding; recursively scan export DTOs before serialization | 11, 15 | SEC-OUT, SEC-DENY, SEC-EXPORT |
| Server-side outbound URL → arbitrary host | Customer, crawled page, redirect target, webhook, SERP/vendor payload | Spoofing, information disclosure, denial of service, elevation of privilege | One resolve-then-pin URL authority; reject private/reserved/metadata ranges and encoded forms; revalidate every redirect; deadline and hop ceiling; no ambient credentials | 00 and every outbound-fetch owner | SEC-URL |
| Customer/user input → persistence and Mongo filters | Authenticated customer, API/MCP caller | Tampering, denial of service, elevation of privilege | Zod ceilings; strip query operators and dotted keys; length-cap before fixed regular expressions; account/scope-namespaced idempotency keys | 00 and every route owner | SEC-BOUND, SEC-INJECT, SEC-IDEMPOTENCY |
| Provider/API configuration → runtime and logs | Operator error, compromised deployment input | Spoofing, information disclosure, denial of service | Root environment only; fake providers boot keyless; live selection fails without its key; persisted secrets use AES-GCM envelopes; enumerated redaction; never expose configuration values | 01–03, 10, 12 | SEC-SECRET, SEC-REDACT, SEC-SUPPLY |

## Shared control register

| Identifier | Batch-wide invariant | Shared authority | Evidence |
|---|---|---|---|
| SEC-URL | Every untrusted outbound URL is resolved, checked, pinned, deadline-bounded, and rechecked per redirect. | `server/src/shared/security/url-safety.ts` | Range matrix, redirect, rebinding, deadline, and direct-fetch guard tests |
| SEC-DENY | Cross-account payloads contain no secret keys/material, raw HTML, prompts/completions, or vendor payload keys. | `server/src/shared/security/denylist-scan.ts` | Shared scanner assertion over every public DTO/export/log sample |
| SEC-REDACT | Every batch secret and content field has top-level and nested Pino redaction paths. | `server/src/config/logger.ts` | Enumerated-secret path and emitted-log tests |
| SEC-BOUND | External strings, arrays, pages, cursors, bodies, fan-out, and batches have explicit ceilings. | `server/src/shared/security/input-guards.ts` | Over-limit and tamper tests at each boundary |
| SEC-INJECT | Untrusted text is data, never instructions, regex source, or a Mongo operator object. | `server/src/shared/security/input-guards.ts` | Operator, regex ceiling, and citation canonicalization tests |
| SEC-OUT | Untrusted output is escaped text with safe JSON-LD, href schemes, and export-cell encoding. | `client/src/shared/security/output-encoding.ts`, `server/src/shared/utils/csv.ts` | Script-breakout, URL-scheme, HTML-text, and formula-prefix tests |
| SEC-RATE | Every new route maps to a named, env-configured bucket persisted in `rate_limit_hits`. | `server/src/shared/middleware/rate-limit.ts` | Classification, env-knob, and persistence tests |
| SEC-SUPPLY | New SDKs are exact-pinned, license-allowed, import-confined, and audit-clean. | `server/eslint.config.js`, `server/src/shared/testing/security/supply-chain.test.ts` | ESLint confinement, manifest/license, and npm audit gates |
| SEC-SECRET | Secrets remain server-side, conditionally required, encrypted before persistence, and absent from DTOs/logs/health. | `server/src/config/env.ts`, `server/src/shared/crypto/` | Reusable fake/live env assertion plus redaction/denylist tests |

## Mandatory consumer rules

- Mongo filters over user-derived values use typed primitives returned by `stripQueryOperators`; never spread an untrusted object into a filter.
- Attacker-controlled text is length-capped before fixed, reviewed regular expressions. Regular expressions are never constructed from user input.
- AI output, competitor snippets, and notes render as React text nodes or escaped PDF/email/JSON-LD values. They never use `dangerouslySetInnerHTML` or raw script interpolation.
- Outbound user-content links use `safeExternalHref` and `rel="nofollow ugc noopener noreferrer"`.
- Any module that logs a new user-content field adds both top-level and nested paths to `REDACTION_PATHS` in the same change.

## SEC-SECRET checklist

| Requirement | Required evidence |
|---|---|
| Secret is declared only in root `.env.example`, `env.ts`, and the API/worker Compose blocks that need it | Env/docs parity test; no client `VITE_` secret |
| Fake/default provider boots without the secret | `envSchema` fake-selection parse succeeds with the key absent |
| Selected live provider fails startup without the secret | `envSchema` live-selection parse fails with the named field error |
| Persisted secret is encrypted before write and the plaintext source is nullified immediately | Envelope round-trip plus persistence/nullification test |
| Secret is absent from logs, health, client env, superadmin, exports, and public DTOs | Enumerated redaction and recursive denylist assertions |

## Acceptance

All shared controls have a named export and a deterministic test. Every later prompt cites the identifier and imports the shared authority instead of copying its logic.
