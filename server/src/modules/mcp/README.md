# MCP module

RankMeFast MCP server. Bearer-authenticated JSON-RPC surface at
`/api/mcp` that exposes ten owner-scoped, provider-neutral tools:

- `list_sites`
- `get_latest_audit_report`
- `list_keywords`
- `get_rank_history`
- `list_content_analyses`
- `get_content_analysis`
- `start_audit` — the only tool that spends vendor calls
- `get_audit_status`
- `list_actions`
- `set_action_state` — writes an append-only decision event; zero vendor spend

## Why not `shared/providers/`?

The `@modelcontextprotocol/sdk` dependency is **protocol infrastructure**, not
a vendor SEO signal adapter. It doesn't sell audit findings, ranks, keywords,
or backlinks — it is a transport layer akin to Express itself. The
`shared/providers/` registry is reserved for SEO signal vendors (DataForSEO,
Google PSI/CrUX, GSC, Firecrawl, AI SDK task profiles), each of which
implements a typed capability interface (audit / rank / keyword / …) with
recorded, redacted fixtures and contract tests.

The MCP SDK does none of that. It exposes an HTTP+JSON-RPC transport plus a
tool-registration API. Confining it to this module (and enforcing that via
`no-restricted-imports` in `server/eslint.config.js`) keeps the vendor boundary
narrow: read tools here call the existing feature modules' read services
(`getAuditReport`, `listKeywords`, `getKeywordHistoryBatch`, `listAnalyses`,
`getAnalysis`, …); the only spending tool (`start_audit`) delegates to
`startAuditForSite` in the audits module so the canonical
parse → own → enqueue order lives in exactly one
place.

## Transport

Streamable HTTP in stateless JSON mode:

- `POST /api/mcp` — every request builds a fresh `McpServer` +
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined,
  enableJsonResponse: true })`, connects, calls `transport.handleRequest`, and
  closes. No session IDs, no SSE streams, no resumability.
- `GET`/`DELETE /api/mcp` — `405 Method Not Allowed` with `Allow: POST`.

## Auth / gating

The mount in `app.ts` layers, in order: per-IP API limiter, `mcp` per-token
rate-limit bucket, existing `createApiKeyAuth` (populates `req.user` from an
`rmf_` bearer using timing-safe sha256 compare in the api-keys module).
`MCP_ENABLED=false` short-circuits with
the localized unavailable response before any auth work.

## Output safety

Every tool result is passed through `assertNoForbidden` (Prompt 00 recursive
denylist scanner) before it's returned to the client — no secret names,
authorization material, raw HTML, prompt/completion text, or vendor payload
keys reach the wire. Reads only surface fields the product UI already shows
the owner.
