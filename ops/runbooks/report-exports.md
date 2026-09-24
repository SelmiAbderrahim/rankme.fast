# Report export operations runbook

Owner: platform operations. The report export system reads stored RankMeFast
data only. It must not make a vendor request, enqueue vendor work, or reserve a
usage unit.

## Hard bounds and refusal behavior

The catalog in `server/src/shared/report-exports/catalog.ts` is authoritative.
Every adapter also has a report-specific selection limit and an explicit list
of narrowing fields. The global ceilings are:

- 10 MiB for the immutable canonical document;
- 25 MiB for any rendered output;
- 100,000 CSV rows; and
- 1,000 represented PDF items.

Adapters and renderers refuse an over-bound request. They never clip, sample,
or silently truncate it. A refusal should tell the signed-in user which catalog
narrowing field to apply. Do not raise a global bound without reviewing Mongo
document size, API response buffering, PDF memory, CSV spreadsheet behavior,
and the corresponding catalog and user documentation.

## Retention and purge

An immutable export snapshot expires 90 days after creation. A manual deletion
marks it unavailable immediately and schedules physical purge after 24 hours.
Account or site denial makes affected snapshots and shares unavailable and
eligible for immediate purge. A share expires at the earlier of its requested
expiry and its snapshot expiry; its default is 30 days, its maximum is 90 days,
and its token record is purged 24 hours after expiry. At most 25 active shares
may exist per account and 5 per snapshot.

The worker owns the `report-export-retention` BullMQ singleton schedule and
runs it every 24 hours. The sweep records expiry/purge audit entries, deletes
eligible snapshot/share records, and is safe to retry. Mongo TTL indexes are a
backstop, not the operational scheduler. Keep the worker and scheduler
reconciler running; after an outage, confirm the singleton exists and let the
next sweep drain overdue records. Do not manually edit canonical snapshot
content to shorten retention.

## Rate limits

Authenticated routes are account-keyed. Export creation uses
`RATE_LIMIT_CONTENT_CREATE_WINDOW_MS` / `RATE_LIMIT_CONTENT_CREATE_MAX`
(default 10 requests per 60 seconds). Listing, inspection, share management,
and authenticated download use `RATE_LIMIT_CONTENT_POLL_WINDOW_MS` /
`RATE_LIMIT_CONTENT_POLL_MAX` (default 60 requests per 60 seconds).

Every public share request first consumes an IP-keyed allowance, then—only
after the bearer has been proved live—a token-digest-keyed allowance. Both use
`RATE_LIMIT_REPORT_EXPORT_PUBLIC_WINDOW_MS` (default 60 seconds); the default
limits are 60 requests per IP and 120 per proved token. Never key a limiter,
metric, or log with the raw share token.

## Safe observability and audit records

The `report_export.outcome` metric event has exactly three variable dimensions:
catalog `kind`, supported `format`, and bounded `status`. Unknown or malformed
values are collapsed to `unknown`. Status is one of `created`, `rendered`,
`downloaded`, `shared`, `accessed`, `revoked`, or `refused`.

Durable audit actions cover create, render, download, share creation, public
access, share revocation, and refusal. Their metadata uses the same three
fields. Share actions emit one bounded record per permitted share format.
Expiry, deletion, and purge use their existing lifecycle audit actions.

Never add report payloads, selections, raw or hashed bearer tokens, filenames,
download headers, byte buffers, client labels, logo data, report titles, report
text, URLs, or refusal text to logs, metric dimensions, or audit metadata.
Counts and scheduler health belong in separate content-free operational events.

## Share incident response and revocation

For one exposed link, revoke it from the report share manager or call the
authenticated revoke route. Revocation takes effect on the next request; no raw
token is needed. Record the operator and affected share ID in the incident
system, not in application logs.

For suspected broad public-link exposure, set `PUBLIC_EXPORTS_ENABLED=false`
in the root environment and redeploy API and web together. This blocks public
share authentication and new export/share creation. It deliberately does not
erase stored snapshots or promise a rollback of authenticated stored-result
reads. Revoke known shares, investigate audit actions using bounded fields,
then re-enable only after the exposure is contained. Rotating unrelated vendor
credentials has no effect on report shares.

## Compatibility facades

Keep these shipped entry points compatible while the unified registry supplies
their shared primitives:

- the legacy audit PDF download;
- scheduled client-report delivery and the client portal;
- `/api/v1` JSON and CSV integrations; and
- feature-owned CSV buttons or native Markdown, JSON-LD, and disavow-text
  downloads.

A facade may preserve its route and response shape, but it must not create a
second report catalog, bypass ownership checks, weaken bounds, or introduce a
vendor call. The canonical export API remains the source for new unified UI.

## Adding a report adapter

1. Add one stable descriptor to `REPORT_CATALOG`, including scope, formats,
   bounds, narrowing fields, branding, sharing, and localization keys.
2. Implement the adapter inside its source feature module. Export it through
   that module's public `index.ts`; it may read only already-stored,
   account-scoped data.
3. Register it in `createCoreReportExportAdapterRegistry`. Do not instantiate
   an adapter in a controller, renderer, route, or client component. The
   registry completeness guard must still match the catalog exactly.
4. Add the kind to the client anchor map and expose `ReportExportControl` only
   where its source record and scope are available. Formats come from server
   capabilities, never from a client-only list.
5. Add all seven locale keys and update all seven report-export user guides if
   the format grouping or user behavior changed.
6. Preserve immutable source dates, stable IDs, schema version 1, complete
   selection semantics, and actionable refusal. Re-run the catalog/registry/
   client/documentation reconciliation before release.

An adapter is a stored-data projection. If it would need a vendor SDK, outbound
HTTP request, new enqueue, capacity reservation, or silent fallback, it is not
eligible for this registry and needs a separate product design.
