# Provider boundary

Feature code imports provider-neutral contracts from `shared/providers/index.ts`.
Concrete vendor payloads, credentials, and HTTP calls stay inside this directory.
SERP host normalization, matching, AI Overview evidence, and retained-row bounds
live in `serp-normalization.ts` and are exported from that public API; rank feature
code does not import the concrete DataForSEO adapter path.

The keyless fake remains the default for
every shipped capability; selecting a live adapter without its validated
credentials fails startup. Firecrawl operations and all six AI SDK adapters are
enrolled in the provider contract/fixture inventory with success, timeout,
malformed, and quota cases. The API and worker build the same registry options
from the same root environment schema. External behavior that cannot be called
without a paid credential is fixture-verified, not claimed live-verified.

## Content source

`ContentSourceProvider` supports only bounded page scrape and bounded site crawl.
The deterministic fake is the default and requires no network or key; it exposes
owned/competitor examples, variations, and injected timeout, malformed, quota,
robots, redirect, partial, and cancellation states.

The live adapter supports Firecrawl v2 Cloud only. `FIRECRAWL_BASE_URL` is an
operator setting fixed to the HTTPS Cloud origin, not a user-editable or self-host
endpoint. Calls use the shared REST boundary without an SDK. Targets and returned
source/redirect URLs delegate to SEC-URL. Requests respect robots, use zero data
retention, disable vendor cache writes, keep TLS verification enabled, and pin
Firecrawl to its basic (non-enhanced) proxy mode. The capability returns bounded
sanitized markdown/text plus normalized facts; raw HTML and vendor request
identifiers never cross the capability.

`FIRECRAWL_API_KEY` remains primary. `FIRECRAWL_FALLBACK_API_KEYS` may contain
up to five ordered credentials for other ZDR-enabled Firecrawl Cloud accounts.
Every logical call starts primary and advances only after HTTP 401, 402, or 429;
403/ZDR rejection, malformed data, timeout, cancellation, and network/5xx faults
never switch credentials. The final typed error is returned after exhaustion.

Scrapes are one-shot. A crawl or monitor can fail over only before its create
request succeeds, after which all polling/lifecycle calls use that credential.
Persisted monitor affinity is an opaque non-authenticating reference; raw keys
stay solely in the root `.env`. New monitor webhooks echo the reference in signed
metadata so cross-account opaque monitor ids correlate safely. Legacy monitors
without affinity remain primary-owned and are never probed across accounts.

Credit cost is not hardcoded vendor pricing. The adapter records reported credits
and multiplies them by `FIRECRAWL_COST_MICROS_PER_CREDIT`, marking the resulting
micros as an estimate.

Unsupported: Search, Agent, Extract, Interact, screenshots, authenticated pages,
custom headers/cookies, enhanced proxy, arbitrary browser actions, and automatic
publishing.

## App data

`AppDataProvider` is the vendor-neutral boundary for Google Play and App Store
research. Every operation receives `store`; the stores are not separate
capabilities. `PROVIDER_APP_DATA=fake` is the deterministic, keyless default.
Selecting `dataforseo` requires both DataForSEO credentials at startup, and an
unknown selection fails startup without falling back to another provider.

The DataForSEO adapter uses the shared authenticated HTTP helper. App search,
listing info, reviews, and top charts use bounded standard-priority task POSTs
followed by bounded polling; keywords, competitors, intersections, and bulk
metrics use Labs live endpoints. The App Data Google namespace is `google`,
while its Labs namespace is `google_play`; Apple uses `apple` for both.

Search is capped at one billed page (30 Google Play rows or 100 App Store rows),
reviews at 300, Labs row operations at 100, intersections at 20 app ids, and bulk
metrics at 50 app ids. Intersection requests fail closed outside US/English.
Only organic search rows cross the boundary, install counts remain displayed
ranges with an optional parsed lower bound, and fields unavailable from Apple
remain `null`. Every operation records the vendor envelope cost through the
shared cost-capture scope. There is no product consumer in this provider wave.

## Structured AI generation

`AiGenerationProvider` is the only generation seam used by `SummaryProvider`. The default
`PROVIDER_AI=fake` is deterministic and keyless for isolated tests only (production
rejects it unless the explicit break-glass flag is enabled). `PROVIDER_AI=ai-sdk` uses AI SDK
6 `generateText` with `Output.object`, disables SDK retries, and applies one global
deadline plus RankMeFast-owned ordered failover. AI SDK telemetry defaults off;
when enabled, `recordInputs` and `recordOutputs` remain false.

| Key | Factory | Exact package | Configuration notes |
|---|---|---|---|
| `glm` | `createOpenAICompatible` | `@ai-sdk/openai-compatible@2.0.60` | Operator-only `GLM_BASE_URL`, SEC-URL validated; no user headers/base URL |
| `deepseek` | `createDeepSeek` | `@ai-sdk/deepseek@2.0.49` | First-party provider package |
| `kimi` | `createMoonshotAI` | `@ai-sdk/moonshotai@2.0.36` | `KIMI_API_KEY`; official Moonshot package; bounded non-thinking mode with provider-fixed sampling for K2.5/K2.6 compatibility |
| `openai` | `createOpenAI` | `@ai-sdk/openai@3.0.85` | First-party provider package |
| `google` | `createGoogleGenerativeAI` | `@ai-sdk/google@3.0.93` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `anthropic` | `createAnthropic` | `@ai-sdk/anthropic@3.0.97` | First-party provider package |

Core `ai@6.0.226` and every provider package are exact-pinned. All are
Apache-2.0 and accept the repository's Zod 3.25.x boundary. Model IDs and
input/output rates are required root configuration for enabled ordered providers;
pricing never lives in source.

Before each call, the runtime checks the worst-case configured bigint-micro cost
against the request ceiling. Retryable timeout/quota/availability/transport and
malformed-output failures continue; auth/safety/invalid-input/budget failures stop.
Unknown usage is charged at the conservative estimate, never zero. A per-account
rolling spend guard rejects with `budget_circuit_open` before any provider call.

SEC-URL covers the GLM endpoint; SEC-BOUND caps timing, attempts, rates, and spend;
SEC-OUT marks validated results untrusted and exposes only fixed warnings;
SEC-REDACT covers all six exact key names; SEC-SUPPLY confines AI imports to this
provider directory; SEC-SECRET keeps keys out of client and admin surfaces.
`ai_usage_events` stores safe attempt metadata and bigint micro-dollars only. Its
daily worker purge uses `AI_USAGE_RETENTION_DAYS` (default 90); it has no content,
vendor prose, credentials, headers, or stacks.

## Task profiles and summary compatibility

Code-reviewed profiles live in `shared/ai-profiles/`. Runtime configuration may
choose provider enablement, models, rates, and global order, but cannot edit task
allowlists, prompt/schema versions, input/output bounds, temperatures, deadlines,
attempt limits, content classifications, or micro-dollar ceilings.

`PROVIDER_SUMMARY=fake` runs the deterministic profile fake;
`PROVIDER_SUMMARY=anthropic` runs the same profile through one Anthropic AI SDK
adapter; `PROVIDER_SUMMARY=ai-sdk` uses the configured global order filtered by
the task allowlist. The compatibility adapter preserves `SummaryProvider` return
shapes. Generated fields remain `trust: untrusted` by contract and every consumer
must render text only.
