# Content Intelligence internal API contract

Status: shipped, authenticated product API. This document is for operators and
first-party client maintainers. It does not make these routes public.

## Exposure decision

RankMeFast's versioned public REST API remains the six Agency-only, read-only
operations documented in `docs/public-api.en.md`. Content Intelligence starts,
cancellations, version saves, and recommendation mutations are deliberately not
mounted under `/api/v1`. Adding them there requires a separate product and
security decision, the public API tier gate, token-hash/IP rate limiting, and a
versioned schema review.

The routes below use a Better Auth session and a verified user. Account identity
comes from the session, never from a body, query, or header. Mutations retain the
application's CSRF protections. Every site is resolved within that account and
the requested origin must match the verified owned site; a cross-account id is
reported as `404`, not `403`.

## Shipped operations

| Purpose | Method and route | Result |
| --- | --- | --- |
| Capacity preview | `GET /api/sites/:siteId/content-analyses/preview` | `200`, no reservation |
| Input preflight | `POST /api/sites/:siteId/content-analyses/preflight` | `200`, no reservation or enqueue |
| Start analysis | `POST /api/sites/:siteId/content-analyses` | `202` with `analysisId`, state, and duplicate marker |
| List analyses | `GET /api/sites/:siteId/content-analyses` | `200` cursor page |
| Read analysis | `GET /api/content-analyses/:analysisId` | `200` owner-scoped normalized result |
| Cancel analysis | `POST /api/content-analyses/:analysisId/cancel` | `202`; terminal records are preserved |
| Regenerate | `POST /api/content-analyses/:analysisId/regenerate` | `202`; a new reservation and run |
| Save a brief or draft version | `POST /api/content-analyses/:analysisId/{brief-versions,draft-versions}` | explicit owner-only save; never publishes |
| Recommendation evidence | `GET /api/content-analyses/:analysisId/recommendations/:recommendationId/{application-check,history,outcome}` | owner-scoped read |
| Recommendation state | `POST /api/content-analyses/:analysisId/recommendations/:recommendationId/{accept,dismiss,apply,undo}` | optimistic, idempotent state change |
| Pro inventory | `/api/sites/:siteId/content-intelligence/inventory` and `/:runId` | start/list/get/cancel; starts reserve page blocks |
| Agency comparison | `/api/sites/:siteId/competitor-content/{suggestions,competitors,runs}` | reviewed portfolio and run operations |
| Agency monitoring | `/api/sites/:siteId/content-monitoring/monitors` and `/:monitorId` | list/create/get/pause/resume/delete |

The zod definitions are the contract authority:

- `server/src/modules/content-intelligence/content-intelligence.schema.ts`
- `server/src/modules/content-intelligence/inventory.schemas.ts`
- `server/src/modules/competitor-content/competitor-content.schemas.ts`
- `server/src/modules/content-monitoring/monitoring.schemas.ts`

Do not duplicate those shapes in a public OpenAPI document.

## Bounds and SSRF boundary

An analysis start accepts one HTTPS owned URL, one bounded keyword, one of
`en`, `ar`, `fr`, `de`, `es`, `ru`, or `zh`, and at most three reviewed public
comparison references. The shared schemas cap URLs at 2,048 characters and
keywords at 200 characters. Parsing is only the first gate: the service also
runs `assertPublicUrlSafe`, resolves DNS safely, rejects credentials, private or
reserved destinations, and verifies the URL against the account's owned site.
Redirects and all later provider fetches remain subject to the provider adapter's
public-destination checks. A caller cannot turn this route into an arbitrary
fetch.

Competitor comparison references are server-reviewed records, not arbitrary URL
slots. Inventory is capped by both the tier catalog and
`CONTENT_INVENTORY_MAX_PAGES`.

## Idempotency and async lifecycle

The shipped internal API uses `clientKey` in the request body; it does not claim
an `Idempotency-Key` HTTP header. Keys are URL-safe and bounded (analysis and
recommendation keys: 1–128 characters). The server derives an account-and-scope
HMAC with `makeIdempotencyKey`, so identical text in two accounts cannot collide.
A replay returns the original record and never makes a second reservation. The
key follows the retained record; there is no separate short-lived header expiry
contract. A future public start operation must define a header replay window
before it ships.

Start and cancellation acceptance use `202`. Analysis states are `queued`, the
bounded collection/scoring/generation states, then `completed`, `partial`,
`failed`, or `cancelled`. Existing reads expose whether a reservation was
refunded and its provider-neutral reason. Partial results keep completed stages;
failed-before-useful-work runs refund according to the reservation ledger.
Disabling a rollout flag refuses a new start with localized `503` before a
reservation, while list/get/cancel remain available and accepted work reaches a
consistent terminal state.

Lists use `limit` 1–100 (default 25) and an opaque, HMAC-authenticated cursor no
longer than 512 characters. Treat cursors as indivisible and stop when the next
cursor is absent.

## Errors, rate limits, and capacity

The internal named, per-account buckets are:

| Bucket | Root configuration |
| --- | --- |
| `content_intelligence_create` | `RATE_LIMIT_CONTENT_CREATE_WINDOW_MS`, `RATE_LIMIT_CONTENT_CREATE_MAX` |
| `content_intelligence_poll` | `RATE_LIMIT_CONTENT_POLL_WINDOW_MS`, `RATE_LIMIT_CONTENT_POLL_MAX` |
| `content_recommendation_state` | `RATE_LIMIT_RECOMMENDATION_WINDOW_MS`, `RATE_LIMIT_RECOMMENDATION_MAX` |
| `inventory_start` | `RATE_LIMIT_INVENTORY_WINDOW_MS`, `RATE_LIMIT_INVENTORY_MAX` |
| `competitor_manage` | `RATE_LIMIT_COMPETITOR_WINDOW_MS`, `RATE_LIMIT_COMPETITOR_MAX` |

`429` includes retry metadata. Capacity exhaustion uses the existing localized
`402` product error. Disabled rollout uses retryable `503`. Validation is `400`,
missing authentication is `401`, and a non-owned or missing resource is `404`.
Capacity is asserted before every vendor-spending enqueue.

## Output and schema safety

First-party responses are provider-neutral. Public schemas and examples must not
contain vendor response objects, credential-shaped response properties, raw
HTML, hidden instruction text, or model request/response bodies. A signed-in
owner may read the generated brief and draft saved on their own analysis; no
other caller can. Sanitized citation excerpts expire after seven days and are
not exposed by `/api/v1`.

## MCP alongside REST

`POST /api/mcp` uses the same RankMeFast API-key store as `/api/v1`, but MCP is
available to Starter, Pro, and Agency when the account/key scopes allow it. It
has its own token-hash/IP-fallback `mcp` rate bucket configured by
`RATE_LIMIT_MCP_WINDOW_MS` and `RATE_LIMIT_MCP_MAX`. `MCP_ENABLED=false` stops
new MCP requests without revoking keys or changing stored data.

Tool discovery is generated from `server/src/modules/mcp/mcp.registry.ts`; input
schemas live in `server/src/modules/mcp/mcp.schema.ts`. Those modules, not this
document, define the names, bounds, scopes, and allowance behavior. The current
registry has ten tools; only `start_audit` spends an allowance. Content
Intelligence MCP tools read stored owner-scoped analyses and do not start a
content analysis or mutate its recommendations.

