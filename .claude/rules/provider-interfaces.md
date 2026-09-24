# Vendor Provider Interfaces — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**Every external SEO signal sits behind a typed capability interface in `server/src/shared/providers/`. Feature modules import the interface, NEVER a vendor SDK or vendor HTTP client. Selecting a vendor whose adapter has not shipped fails startup loudly — no silent fallback.**

## Why this rule exists

- **Vendor swap must be a config change**, not a refactor. When DataForSEO's price doubles or Google deprecates URL Inspection, we swap adapters — feature code does not change.
- **Fake providers are first-class.** Deterministic in-memory fakes back development and CI. Nothing about the stack should demand a vendor key to boot.
- **Ponytail:** we build an adapter only when the tier that needs it ships. Never pre-build for vendors we don't call.

## Capability interfaces

Every capability has its own TypeScript interface in `server/src/shared/providers/<name>.ts`:

| Capability | Interface | Env |
|------------|-----------|-----|
| Audit crawl → onpage findings | `AuditProvider` | `PROVIDER_AUDIT` |
| Keyword → SERP position | `RankProvider` | `PROVIDER_RANK` |
| Seed → volume + difficulty | `KeywordProvider` | `PROVIDER_KEYWORD` |
| Domain → backlink profile | `BacklinkProvider` | `PROVIDER_BACKLINK` |
| Domain → competitor list | `CompetitorProvider` | `PROVIDER_COMPETITOR` |
| URL → PSI + CrUX | `PageSpeedProvider` | `PROVIDER_PAGESPEED` |
| URL → GSC inspection | `GscProvider` | `PROVIDER_GSC` |
| Findings → plain-text summary | `SummaryProvider` | `PROVIDER_SUMMARY` |
| URL/site → bounded content | `ContentSourceProvider` | `PROVIDER_CONTENT_SOURCE` |
| Public URL → recurring change monitor | `ContentMonitorProvider` | `PROVIDER_CONTENT_SOURCE` |
| Mobile app stores → search, listing, reviews, charts, keywords, competitors, intersections, metrics | `AppDataProvider` | `PROVIDER_APP_DATA` |

Each interface declares:

- Operations as async functions with narrow input/output shapes (zod-validated at the vendor boundary).
- No vendor-shaped fields (`items[].se_result[0].link` is a DataForSEO detail, not our shape).
- No secrets in return values.

The registry (`server/src/shared/providers/registry.ts`) picks the concrete adapter from `PROVIDER_<cap>`. Unknown or unshipped vendor values throw at startup.

## Correct

```typescript
// server/src/modules/ranks/ranks.service.ts
import { getRankProvider } from "@shared/providers";

export async function trackRank(input: TrackRankInput) {
  const rank = getRankProvider();
  const result = await rank.serp({
    keyword: input.keyword,
    geo: input.geo,
    device: input.device,
  });
  return persistRankSnapshot(result);
}
```

```typescript
// server/src/shared/providers/dataforseo/serp.ts
import { dataForSeoRequest } from "../http";
import { serpResponseSchema } from "./schemas";
import type { RankProvider } from "../rank";

export const dataForSeoRankProvider: RankProvider = {
  async serp(input) {
    const raw = await dataForSeoRequest(cfg, "/serp/google/organic/live/advanced", tasks, serpResponseSchema);
    return normalize(raw);
  },
};
```

## Forbidden

```typescript
// WRONG — feature module imports a vendor SDK
import { GoogleAuth } from "google-auth-library";        // ← blocked by ESLint from modules/**
import Anthropic from "@anthropic-ai/sdk";                // ← same

// WRONG — feature module hits a vendor URL directly
await fetch("https://api.dataforseo.com/v3/serp/...");

// WRONG — pre-shipping an unused adapter
// (ships file `providers/moz/backlinks.ts` when Moz is not the active vendor)

// WRONG — silent fallback to `fake` when the configured vendor is unavailable
// The registry must throw on an unknown / unshipped PROVIDER_* value.
```

### Explicit same-vendor credential pools

The no-silent-fallback rule is about changing provider implementations. A
bounded, operator-configured pool of credentials for the **same shipped vendor**
is allowed only when its adapter documents all of the following:

- exact HTTP statuses that advance the pool;
- deterministic primary-first ordering and an attempt ceiling;
- no fallback to `fake`, another vendor, or weaker security settings;
- resource affinity after an asynchronous/resource-creation request succeeds;
- final typed error behavior after exhaustion; and
- redaction plus contract tests for every credential-array field.

Firecrawl is the current example: only 401/402/429 advance; 403/ZDR, malformed,
timeout, network/5xx, and cancellation do not. Crawls and monitors stay pinned
to the account that created them, and every configured account must have ZDR.

## Contract tests + fixtures

Every real provider adapter MUST ship contract tests that cover the four mandatory paths:

- `success` — a canonical vendor response returns the normalized shape.
- `timeout` — an aborted fetch surfaces `VendorTimeoutError`.
- `malformed` — a shape mismatch surfaces `VendorMalformedError`.
- `quota` — 429 / vendor-specific quota code surfaces `VendorQuotaError` with `retryAfterSeconds`.

Additional cases per operation (e.g. `in-queue`, `unavailable`, `dataset-miss` for CrUX).

- Fixtures live under `server/src/shared/testing/fixtures/<provider>/<operation>/<case>.json`.
- Fixtures are RECORDED vendor responses stored verbatim after `src/scripts/run-redact-fixture.ts` (credential keys dropped, emails replaced, task ids → `TASK_ID`).
- `fixture-lint.ts` fails the suite on any committed secret pattern.
- Tests use `mockVendor(provider, operation, case)` (msw) and assert via `providerContractTests(...)`.

## Error taxonomy

All adapters throw the same errors from `shared/providers/errors.ts`:

| Error | HTTP-ish source | Retryable |
|-------|-----------------|-----------|
| `VendorTimeoutError` | AbortController fired | yes |
| `VendorMalformedError` | zod mismatch | no |
| `VendorQuotaError` | 429 / vendor 402xx | yes (with `retryAfterSeconds`) |
| `VendorAuthError` | 401 / vendor 401xx | no |
| `VendorUnavailableError` | 5xx / vendor 5xxxx | yes |

Job processors map `retryable` onto BullMQ retries; non-retryable throws surface as `UnrecoverableError` and go straight to the dead-letter queue.

## Ponytail decisions

- **One selected vendor per capability.** `fake` is an explicit selection, not a runtime fallback. Documented named alternatives (Moz, SEMrush, DataForSEO Lighthouse) are comment-only until a tier needs them.
- **Fixtures live in-repo** up to a soft ~5 MB ceiling. Beyond that, move to S3 lazy-download.
- **No allow-list on the contract meta-check** — a new provider under `shared/providers/<vendor>/` is automatically enrolled in `contract-meta.test.ts`.

## Validation Checklist

- [ ] No import of a vendor SDK / vendor URL outside `server/src/shared/providers/`
- [ ] Every real adapter has success / timeout / malformed / quota fixtures
- [ ] Fixtures pass `fixture-lint.ts` (no credentials, no PII)
- [ ] Adapter throws exclusively via `shared/providers/errors.ts`
- [ ] Feature module receives the capability interface, not a concrete adapter
- [ ] `PROVIDER_<cap>` pointing to an un-shipped adapter fails startup loudly
