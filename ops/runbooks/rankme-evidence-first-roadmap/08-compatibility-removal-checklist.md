# 08 — Compatibility-removal checklist (redacted)

Scope: anything the roadmap kept for one release window. Removal happens in a
FUTURE release, never in the release that introduced the replacement.

## Inventory (as shipped)

- The roadmap's API surface landed **additively**: the roadmap introduced
  new routes and added fields to existing DTOs; no field was removed and no
  route family was replaced by a queued twin inside this batch. The spec-15
  §4 rows that anticipated "legacy sync → queued" swaps for ai-visibility and
  keyword gap were superseded: the shipped ai-visibility runs are versioned
  jobs from day one, and keyword gap/overview/trends shipped synchronous with
  cache + capacity enforcement (recorded as an inline spec correction).
- Public API (`/api/v1`) and MCP tool lists: additive only. Saved URL tab
  states, stored email links, and agency exports all keep resolving.

## Before removing ANYTHING later

1. Confirm one full release cycle shipped with the replacement live and the
   deprecation documented in `docs/public-api.*.md` (all 7 locales).
2. Search stored artifacts that embed URLs (email templates, digests,
   `deepLinkPath` columns) for the route/param being removed — links in
   already-sent email must keep working or redirect.
3. Grep client + e2e + MCP tool definitions for the route.
4. Remove docs references in the same PR (docs-integrity link checks fail
   otherwise).
5. Keep the deprecation metadata (RFC 8594 `Deprecation`/`Sunset` headers) on
   the route for its final release; remove route + headers together.
6. Cross-account behavior of any surviving redirect stays 404-shaped — a
   removed-route redirect must not leak resource existence.

## Currently removable: nothing

As of this release there is no deprecated surface awaiting removal. This file
exists so the NEXT batch has a place to queue removals instead of doing them
ad hoc.
