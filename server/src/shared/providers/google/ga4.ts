/**
 * Google Analytics 4 adapter.
 *
 * Implements the vendor-neutral `Ga4Provider` interface over two Google APIs:
 *
 *   - **Account summaries** — `GET
 *     https://analyticsadmin.googleapis.com/v1beta/accountSummaries`
 *     → `accountSummaries[{ displayName, propertySummaries[{ property,
 *     displayName }] }]`, flattened to `{ propertyId, displayName }`.
 *     Single page at `pageSize=200` — accounts with more properties than
 *     that are out of scope for the one-property-per-connection model.
 *   - **Run report** — `POST
 *     https://analyticsdata.googleapis.com/v1beta/{property}:runReport`
 *     body `{ dateRanges, dimensions, metrics, limit }` →
 *     `rows[{ dimensionValues[{ value }], metricValues[{ value }] }]`.
 *     Metric values arrive as strings and are parsed to numbers.
 *   - **Web data streams** — `GET
 *     https://analyticsadmin.googleapis.com/v1beta/{property}/dataStreams`
 *     → the configured `webStreamData.defaultUri` used for deterministic
 *     Site-to-property matching. Android/iOS streams are ignored.
 *
 * Token lifecycle (refresh/revoke) deliberately lives on the GSC adapter —
 * both capabilities share ONE Google OAuth connection, so callers resolve an
 * access token via the connections service and pass it in.
 *
 * Error taxonomy (via `fetchGoogleGsc`):
 *   - HTTP 401 → `GscReconnectRequiredError` (shared connection goes
 *     `needs_reconnect` — one token, one status).
 *   - HTTP 403 → `VendorAuthError` (Analytics scope not effective on the
 *     shared grant, Admin/Data API disabled, or no accessible GA property).
 *   - HTTP 429 → `VendorQuotaError` (Data API core-token exhaustion).
 *   - HTTP 5xx / network drop → `VendorUnavailableError`.
 *   - Timeout → `VendorTimeoutError`.
 *   - Non-JSON / schema mismatch → `VendorMalformedError`.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorMalformedError } from '../errors.js';
import type { Ga4Property, Ga4Provider, Ga4RunReportInput, Ga4RunReportResult, Ga4WebDataStream, GscConnection, } from '../types.js';
import { fetchGoogleGsc } from './gsc.js';
// ---------------------------------------------------------------------------
// Defaults + endpoints (verified July 2026).
// ---------------------------------------------------------------------------
export const DEFAULT_GA4_TIMEOUT_MS = 15000;
const ACCOUNT_SUMMARIES_URL = 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200';
// `{property}` is replaced with the GA4 resource name (`properties/123`).
export const RUN_REPORT_URL_TEMPLATE = 'https://analyticsdata.googleapis.com/v1beta/{property}:runReport';
export const DATA_STREAMS_URL_TEMPLATE = 'https://analyticsadmin.googleapis.com/v1beta/{property}/dataStreams?pageSize=200';
export function expandPropertyTemplate(template: string, propertyId: string): string {
    return template.replace('{property}', propertyId);
}
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const accountSummariesSchema = z
    .object({
    accountSummaries: z
        .array(z
        .object({
        propertySummaries: z
            .array(z
            .object({
            property: z.string(),
            displayName: z.string().optional(),
        })
            .passthrough())
            .optional(),
    })
        .passthrough())
        .optional(),
})
    .passthrough();
const runReportSchema = z
    .object({
    rows: z
        .array(z
        .object({
        dimensionValues: z
            .array(z.object({ value: z.string().optional() }).passthrough())
            .optional(),
        metricValues: z
            .array(z.object({ value: z.string().optional() }).passthrough())
            .optional(),
    })
        .passthrough())
        .optional(),
    rowCount: z.number().int().optional(),
})
    .passthrough();
const dataStreamsSchema = z
    .object({
    dataStreams: z
        .array(z
        .object({
        name: z.string(),
        displayName: z.string().optional(),
        type: z.string(),
        webStreamData: z
            .object({ defaultUri: z.string().optional() })
            .passthrough()
            .optional(),
    })
        .passthrough())
        .optional(),
})
    .passthrough();
// ---------------------------------------------------------------------------
// Config + normalization
// ---------------------------------------------------------------------------
export interface GoogleGa4ProviderConfig {
    clientId: string;
    clientSecret: string;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    accountSummariesUrl?: string;
    /** Template containing `{property}` — replaced with the resource name. */
    dataStreamsUrlTemplate?: string;
    /** Template containing `{property}` — replaced with the resource name. */
    runReportUrlTemplate?: string;
}
// Data API serializes metric values as strings ("123"); coerce, treating
// anything non-finite as 0 so one weird cell never poisons a snapshot.
function toMetricNumber(value: string | undefined): number {
    if (value === undefined)
        return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
export function normalizeRunReport(payload: unknown, ctx: {
    provider: string;
    operation: string;
}, echo: {
    startDate: string;
    endDate: string;
    dimensions: string[];
    metrics: string[];
}): Ga4RunReportResult {
    const parsed = runReportSchema.safeParse(payload);
    if (!parsed.success) {
        throw new VendorMalformedError(`runReport payload failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
    }
    return {
        rows: (parsed.data.rows ?? []).map((row) => ({
            dimensionValues: (row.dimensionValues ?? []).map((v) => v.value ?? ''),
            metricValues: (row.metricValues ?? []).map((v) => toMetricNumber(v.value)),
        })),
        rowCount: parsed.data.rowCount ?? 0,
        startDate: echo.startDate,
        endDate: echo.endDate,
        dimensions: echo.dimensions,
        metrics: echo.metrics,
    };
}
export function normalizeAccountSummaries(payload: unknown, ctx: {
    provider: string;
    operation: string;
}): Ga4Property[] {
    const parsed = accountSummariesSchema.safeParse(payload);
    if (!parsed.success) {
        throw new VendorMalformedError(`account summaries payload failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
    }
    return (parsed.data.accountSummaries ?? []).flatMap((account) => (account.propertySummaries ?? []).map((property) => ({
        propertyId: property.property,
        displayName: property.displayName ?? property.property,
    })));
}
export function normalizeWebDataStreams(payload: unknown, ctx: {
    provider: string;
    operation: string;
}): Ga4WebDataStream[] {
    const parsed = dataStreamsSchema.safeParse(payload);
    if (!parsed.success) {
        throw new VendorMalformedError(`data streams payload failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
    }
    return (parsed.data.dataStreams ?? [])
        .filter((stream) => stream.type === 'WEB_DATA_STREAM')
        .map((stream) => ({
        streamId: stream.name,
        displayName: stream.displayName ?? stream.name,
        defaultUri: stream.webStreamData?.defaultUri ?? '',
    }));
}
// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------
export function createGoogleGa4Provider(cfg: GoogleGa4ProviderConfig): Ga4Provider {
    if (!cfg.clientId || !cfg.clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for the GA4 provider');
    }
    const fetchImpl = cfg.fetchImpl ?? fetch;
    const timeoutMs = cfg.timeoutMs ?? DEFAULT_GA4_TIMEOUT_MS;
    const accountSummariesUrl = cfg.accountSummariesUrl ?? ACCOUNT_SUMMARIES_URL;
    const dataStreamsUrlTemplate = cfg.dataStreamsUrlTemplate ?? DATA_STREAMS_URL_TEMPLATE;
    const runReportUrlTemplate = cfg.runReportUrlTemplate ?? RUN_REPORT_URL_TEMPLATE;
    const loggerOpt = cfg.logger ? { logger: cfg.logger } : {};
    return {
        async listProperties(connection: GscConnection): Promise<Ga4Property[]> {
            const payload = await fetchGoogleGsc({
                operation: 'ga4-account-summaries',
                method: 'GET',
                url: accountSummariesUrl,
                accessToken: connection.accessToken,
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            return normalizeAccountSummaries(payload, {
                provider: 'google',
                operation: 'ga4-account-summaries',
            });
        },
        async listWebDataStreams(connection: GscConnection, propertyId: string): Promise<Ga4WebDataStream[]> {
            const payload = await fetchGoogleGsc({
                operation: 'ga4-data-streams',
                method: 'GET',
                url: expandPropertyTemplate(dataStreamsUrlTemplate, propertyId),
                accessToken: connection.accessToken,
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            return normalizeWebDataStreams(payload, {
                provider: 'google',
                operation: 'ga4-data-streams',
            });
        },
        async runReport(connection: GscConnection, input: Ga4RunReportInput): Promise<Ga4RunReportResult> {
            const payload = await fetchGoogleGsc({
                operation: 'ga4-run-report',
                method: 'POST',
                url: expandPropertyTemplate(runReportUrlTemplate, input.propertyId),
                accessToken: connection.accessToken,
                jsonBody: {
                    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
                    dimensions: input.dimensions.map((name) => ({ name })),
                    metrics: input.metrics.map((name) => ({ name })),
                    limit: input.limit ?? 1000,
                },
                timeoutMs,
                fetchImpl,
                ...loggerOpt,
            });
            return normalizeRunReport(payload, { provider: 'google', operation: 'ga4-run-report' }, {
                startDate: input.startDate,
                endDate: input.endDate,
                dimensions: input.dimensions,
                metrics: input.metrics,
            });
        },
    };
}
