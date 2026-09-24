import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { GscSearchAnalyticsSnapshotRow, PagePerformanceKeyword, PagePerformanceSnapshot } from '../../db/schema/index.js';
import { readLatestCompletedPageInventory, type AuditPageInventory } from '../audits/index.js';
import { resolveStoredPagesGscState, type StoredPagesGscState, } from '../google-connections/index.js';
import { readLatestGscSyncRun, readLatestPagesGscSnapshot, readPagesGscHistory, readPagesGscSnapshotAtDate, readPreviousPagesGscSnapshot, type PagesGscSnapshot, } from '../gsc-snapshots/index.js';
import { SITE_RANKED_KEYWORD_CACHE_TTL_MS } from '../ranks/index.js';
import { loadOwnedSite } from '../sites/index.js';
import { DEFAULT_PAGES_DIRECTIONS, PAGES_INSIGHTS, type PagesInsight, type PagesListQuery, type PagesRange, type PagesSort, } from './pages.schema.js';
import { createPagesRepository, type PagesRepository, } from './pages.repository.js';
import type { PagesFallbackRefreshService } from './fallback-refresh.service.js';
import { resolvePagesFallbackMarket, type PagesFallbackMarket } from './market-resolver.js';
import { canonicalizePageUrl } from './url-normalizer.js';
import type { PageMetrics, PageQueryRow, PageRow, PagesCoverage, PagesDetailResponse, PagesEnvelope, PagesFallbackReason, PagesListResponse, PagesRefreshResponse, PagesSource, PagesStatus, TrendPoint, } from './pages.types.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const GSC_STALE_MS = 48 * 60 * 60 * 1000;
const CURSOR_TTL_MS = DAY_MS;
const GSC_SEPARATOR = '\u001f';
export type PagesErrorCode = 'PAGES_INVALID_REQUEST' | 'PAGES_INVALID_CURSOR' | 'PAGES_SITE_NOT_FOUND' | 'PAGES_PAGE_NOT_FOUND' | 'PAGES_RATE_LIMITED' | 'PAGES_CAP_EXCEEDED' | 'PAGES_GSC_UNAVAILABLE' | 'PAGES_PROVIDER_UNAVAILABLE' | 'PAGES_REFRESH_FAILED';
export class PagesError extends Error {
    constructor(readonly status: number, readonly code: PagesErrorCode, readonly messageKey: string, readonly details?: Record<string, unknown>, readonly state?: PagesListResponse) {
        super(messageKey);
        this.name = 'PagesError';
    }
}
interface SiteShape {
    id: string;
    url: string;
    domain: string;
}
interface MaterialPage extends PageRow {
    associated: PageQueryRow[];
    searchText: string;
    weight: number;
    previousClicks: number | null;
}
interface SourceMaterial {
    site: SiteShape;
    envelope: PagesEnvelope;
    pages: MaterialPage[];
    inventoryFingerprint: string;
    sourceSnapshot: PagesGscSnapshot | PagePerformanceSnapshot | null;
    fallbackContext: PagesFallbackMarket | null;
    auditRunId: string | null;
}
interface CursorPayload {
    v: 1;
    q: string;
    i: string;
    n: boolean;
    p: string | number | null;
    u: string;
    id: string;
    iat: number;
    exp: number;
}
export interface PagesServiceDeps {
    db: Db;
    cursorSecret: string;
    providerSelection: 'fake' | 'dataforseo';
    fallbackRefresh: PagesFallbackRefreshService;
    now?: () => Date;
    repository?: PagesRepository;
    loadSite?: (accountId: string, siteId: string) => Promise<SiteShape>;
    resolveGscState?: (accountId: string, siteId: string, siteUrl: string) => Promise<StoredPagesGscState>;
    readAudit?: (accountId: string, siteId: string) => Promise<AuditPageInventory>;
    syncGsc?: (input: {
        accountId: string;
        siteId: string;
        domain: string;
        propertyUrlHash: string;
        bindingGenerationId: string;
    }) => Promise<{
        status: 'ok' | 'no-data' | 'not-connected' | 'needs-reconnect' | 'unavailable';
        snapshotDate: string | null;
    }>;
    telemetry?: (event: string, fields: Record<string, unknown>) => void;
}
export interface PagesService {
    list(accountId: string, siteId: string, query: PagesListQuery): Promise<PagesListResponse>;
    detail(accountId: string, siteId: string, pageId: string, range: PagesRange): Promise<PagesDetailResponse>;
    refresh(accountId: string, siteId: string): Promise<PagesRefreshResponse>;
}
function nullMetrics(source: PagesSource = 'none'): PageMetrics {
    return {
        clicks: source === 'gsc' ? 0 : null,
        impressions: source === 'gsc' ? 0 : null,
        ctr: null,
        averagePosition: null,
        bestPosition: null,
        keywordCount: null,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
        associatedQueryCount: 0,
    };
}
function hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function rangeDays(range: PagesRange): 7 | 28 | 90 {
    return Number.parseInt(range, 10) as 7 | 28 | 90;
}
function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}
function finite(value: number): number | null {
    return Number.isFinite(value) ? value : null;
}
function sumKnown(values: readonly (number | null)[]): number | null {
    const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return known.length ? finite(known.reduce((sum, value) => sum + value, 0)) : null;
}
function weightedAverage(rows: readonly {
    value: number;
    weight: number;
}[]): number | null {
    const positive = rows.filter((row) => row.weight > 0 && Number.isFinite(row.value));
    if (positive.length > 0) {
        const weight = positive.reduce((sum, row) => sum + row.weight, 0);
        return finite(positive.reduce((sum, row) => sum + row.value * row.weight, 0) / weight);
    }
    const known = rows.filter((row) => Number.isFinite(row.value));
    return known.length
        ? finite(known.reduce((sum, row) => sum + row.value, 0) / known.length)
        : null;
}
function deltas(current: PageMetrics, previous: PageMetrics | null): {
    positionChange: number | null;
    clickChangePct: number | null;
} {
    const positionChange = current.averagePosition !== null && previous?.averagePosition !== null && previous?.averagePosition !== undefined
        ? previous.averagePosition - current.averagePosition
        : null;
    const clickChangePct = current.clicks !== null && previous?.clicks !== null && previous?.clicks !== undefined && previous.clicks !== 0
        ? (current.clicks - previous.clicks) / previous.clicks
        : null;
    return { positionChange, clickChangePct };
}
export function classifyPageInsights(row: Pick<PageRow, 'performanceSource' | 'isIndexable' | 'metrics' | 'deltas'>, previousClicks: number | null): PagesInsight[] {
    const { metrics, deltas: change } = row;
    const insights: PagesInsight[] = [];
    if (metrics.averagePosition !== null &&
        metrics.averagePosition > 3 &&
        metrics.averagePosition <= 20 &&
        ((metrics.impressions ?? -1) >= 100 || (metrics.searchVolume ?? -1) >= 100))
        insights.push('striking_distance');
    if (row.performanceSource === 'gsc' &&
        (metrics.impressions ?? -1) >= 100 &&
        metrics.averagePosition !== null &&
        metrics.averagePosition <= 10 &&
        metrics.ctr !== null &&
        metrics.ctr < 0.02)
        insights.push('low_ctr');
    if ((change.positionChange !== null && change.positionChange <= -3) ||
        (row.performanceSource === 'gsc' && previousClicks !== null && previousClicks >= 10 && change.clickChangePct !== null && change.clickChangePct <= -0.2))
        insights.push('declining');
    if ((change.positionChange !== null && change.positionChange >= 3) ||
        (row.performanceSource === 'gsc' && previousClicks !== null && previousClicks >= 10 && change.clickChangePct !== null && change.clickChangePct >= 0.2))
        insights.push('winning');
    if (row.isIndexable === false && row.performanceSource !== null)
        insights.push('non_indexable_visibility');
    if (row.performanceSource === null)
        insights.push('unmeasured');
    return PAGES_INSIGHTS.filter((insight) => insights.includes(insight));
}
function aggregateFallback(rows: readonly PagePerformanceKeyword[]): PageMetrics {
    const volumeWeights = rows.map((row) => ({ value: row.position, weight: Math.max(row.searchVolume ?? 0, 0) }));
    const difficulties = rows
        .filter((row): row is PagePerformanceKeyword & {
        difficulty: number;
    } => row.difficulty !== null)
        .map((row) => ({ value: row.difficulty, weight: Math.max(row.searchVolume ?? 0, 0) }));
    return {
        clicks: null,
        impressions: null,
        ctr: null,
        averagePosition: weightedAverage(volumeWeights),
        bestPosition: Math.min(...rows.map((row) => row.position)),
        keywordCount: rows.length,
        searchVolume: sumKnown(rows.map((row) => row.searchVolume)),
        difficulty: weightedAverage(difficulties),
        estimatedTraffic: sumKnown(rows.map((row) => row.estimatedTraffic)),
        associatedQueryCount: rows.length,
    };
}
function aggregateGsc(rows: readonly GscSearchAnalyticsSnapshotRow[]): PageMetrics {
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : null,
        averagePosition: weightedAverage(rows.map((row) => ({ value: row.position, weight: row.impressions }))),
        bestPosition: null,
        keywordCount: null,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
        associatedQueryCount: 0,
    };
}
function associatedFallback(rows: readonly PagePerformanceKeyword[]): PageQueryRow[] {
    return rows.map((row) => ({
        query: row.keyword,
        position: row.position,
        clicks: null,
        impressions: null,
        ctr: null,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        estimatedTraffic: row.estimatedTraffic,
    }));
}
function associatedGsc(rows: readonly GscSearchAnalyticsSnapshotRow[]): PageQueryRow[] {
    return rows
        .map((row) => ({
        query: row.dimensionKey.split(GSC_SEPARATOR)[0]!,
        position: row.position,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
    }))
        .sort((left, right) => right.clicks! - left.clicks! ||
        right.impressions! - left.impressions! ||
        left.query.localeCompare(right.query));
}
function groupByPageHash<T extends {
    pageHash: string;
}>(rows: readonly T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const group = groups.get(row.pageHash) ?? [];
        group.push(row);
        groups.set(row.pageHash, group);
    }
    return groups;
}
function emptyCoverage(source: PagesSource): PagesCoverage {
    return {
        reportingLagDays: source === 'gsc' ? 3 : null,
        sampled: source === 'gsc' ? null : null,
        sourceRowsFetched: source === 'gsc' ? null : 0,
        sourceRowsAccepted: 0,
        sourceRowsDropped: 0,
        dropped: { malformedUrl: 0, offsiteUrl: 0, duplicateUrl: 0, invalidMetric: 0 },
        sourceLimit: source === 'gsc' ? 1000 : 100,
        sourceTruncated: false,
        auditRowsFetched: 0,
        auditRowsAccepted: 0,
        auditRowsDropped: 0,
        auditTruncated: false,
        inventoryPages: 0,
        measuredPages: 0,
        unmeasuredPages: 0,
    };
}
function fallbackStatus(snapshot: PagePerformanceSnapshot, now: Date): PagesStatus {
    if (snapshot.successfulEmpty)
        return 'empty';
    return now.getTime() >= snapshot.cacheFetchedAt.getTime() + SITE_RANKED_KEYWORD_CACHE_TTL_MS
        ? 'stale'
        : 'ready';
}
function materialCacheState(material: SourceMaterial): 'hit' | 'miss' | 'not_applicable' {
    return material.sourceSnapshot && 'cacheStatus' in material.sourceSnapshot
        ? material.sourceSnapshot.cacheStatus
        : 'not_applicable';
}
function mergeAudit(pages: Map<string, MaterialPage>, audit: AuditPageInventory, siteUrl: string, coverage: PagesCoverage): void {
    const seen = new Set<string>();
    for (const row of audit.rows) {
        const canonical = canonicalizePageUrl(row.url, siteUrl);
        if (!canonical.ok) {
            coverage.auditRowsDropped += 1;
            continue;
        }
        if (seen.has(canonical.value.pageHash)) {
            coverage.auditRowsDropped += 1;
            continue;
        }
        seen.add(canonical.value.pageHash);
        coverage.auditRowsAccepted += 1;
        const existing = pages.get(canonical.value.pageHash);
        if (existing) {
            existing.title = row.title;
            existing.isIndexable = row.isIndexable;
            existing.nonIndexableReason = row.nonIndexableReason;
            existing.onPageScore = row.onPageScore;
            continue;
        }
        if (!row.isIndexable)
            continue;
        pages.set(canonical.value.pageHash, {
            pageId: canonical.value.pageHash,
            url: canonical.value.canonicalUrl,
            displayUrl: canonical.value.displayUrl,
            title: row.title,
            performanceSource: null,
            isIndexable: true,
            nonIndexableReason: row.nonIndexableReason,
            onPageScore: row.onPageScore,
            metrics: nullMetrics(),
            deltas: { positionChange: null, clickChangePct: null },
            insights: ['unmeasured'],
            associated: [],
            searchText: '',
            weight: 0,
            previousClicks: null,
        });
    }
}
function finishPages(pages: Map<string, MaterialPage>, coverage: PagesCoverage): MaterialPage[] {
    const result = [...pages.values()];
    for (const page of result) {
        page.insights = classifyPageInsights(page, page.previousClicks);
        page.searchText = [
            page.url,
            page.displayUrl,
            page.title ?? '',
            ...page.associated.map((row) => row.query),
        ].join('\u0000').normalize('NFKC').toLowerCase();
    }
    coverage.inventoryPages = result.length;
    coverage.measuredPages = result.filter((row) => row.performanceSource !== null).length;
    coverage.unmeasuredPages = result.length - coverage.measuredPages;
    return result;
}
function publicPage(page: MaterialPage): PageRow {
    return {
        pageId: page.pageId,
        url: page.url,
        displayUrl: page.displayUrl,
        title: page.title,
        performanceSource: page.performanceSource,
        isIndexable: page.isIndexable,
        nonIndexableReason: page.nonIndexableReason,
        onPageScore: page.onPageScore,
        metrics: page.metrics,
        deltas: page.deltas,
        insights: page.insights,
    };
}
function summaryFor(pages: readonly MaterialPage[], source: PagesSource): PageMetrics {
    if (pages.length === 0)
        return nullMetrics(source);
    const measured = pages.filter((page) => page.performanceSource !== null);
    if (source === 'none' && measured.length === 0)
        return nullMetrics();
    const clicks = source === 'gsc' ? measured.reduce((sum, page) => sum + page.metrics.clicks!, 0) : null;
    const impressions = source === 'gsc' ? measured.reduce((sum, page) => sum + page.metrics.impressions!, 0) : null;
    return {
        clicks,
        impressions,
        ctr: impressions !== null && clicks !== null && impressions > 0 ? clicks / impressions : null,
        averagePosition: weightedAverage(measured
            .filter((page) => page.metrics.averagePosition !== null)
            .map((page) => ({ value: page.metrics.averagePosition!, weight: page.weight }))),
        bestPosition: source === 'gsc' ? null : measured.length ? Math.min(...measured.map((page) => page.metrics.bestPosition!)) : null,
        keywordCount: source === 'gsc' ? null : measured.reduce((sum, page) => sum + page.metrics.keywordCount!, 0),
        searchVolume: source === 'gsc' ? null : sumKnown(measured.map((page) => page.metrics.searchVolume)),
        difficulty: source === 'gsc' ? null : weightedAverage(measured.filter((page) => page.metrics.difficulty !== null).map((page) => ({ value: page.metrics.difficulty!, weight: page.metrics.searchVolume ?? 0 }))),
        estimatedTraffic: source === 'gsc' ? null : sumKnown(measured.map((page) => page.metrics.estimatedTraffic)),
        associatedQueryCount: measured.reduce((sum, page) => sum + page.metrics.associatedQueryCount, 0),
    };
}
function primary(row: PageRow, sort: PagesSort): string | number | null {
    const severity = ['non_indexable_visibility', 'declining', 'striking_distance', 'low_ctr', 'winning', 'unmeasured'];
    if (sort === 'opportunity') {
        const ranks = row.insights.map((value) => severity.indexOf(value)).filter((value) => value >= 0);
        // Opportunity defaults to descending. Give the most urgent flag the
        // largest score so the documented severity order is preserved, while an
        // explicit ascending direction still produces the exact reverse order.
        return ranks.length ? severity.length - Math.min(...ranks) : 0;
    }
    if (sort === 'url')
        return row.url;
    if (sort === 'title')
        return row.title;
    const metric: Record<Exclude<PagesSort, 'opportunity' | 'url' | 'title' | 'position_change' | 'click_change_pct'>, keyof PageMetrics> = {
        clicks: 'clicks', impressions: 'impressions', ctr: 'ctr', average_position: 'averagePosition',
        best_position: 'bestPosition', keyword_count: 'keywordCount', search_volume: 'searchVolume',
        difficulty: 'difficulty', estimated_traffic: 'estimatedTraffic',
    };
    if (sort === 'position_change')
        return row.deltas.positionChange;
    if (sort === 'click_change_pct')
        return row.deltas.clickChangePct;
    return row.metrics[metric[sort]] as number | null;
}
function sortPages(rows: MaterialPage[], sort: PagesSort, direction: 'asc' | 'desc'): MaterialPage[] {
    const sign = direction === 'asc' ? 1 : -1;
    return rows.sort((left, right) => {
        const a = primary(left, sort);
        const b = primary(right, sort);
        if (a === null && b !== null)
            return 1;
        if (a !== null && b === null)
            return -1;
        if (a !== null && b !== null) {
            const compared = typeof a === 'number' && typeof b === 'number'
                ? a - b
                : String(a).localeCompare(String(b));
            if (compared !== 0)
                return compared * sign;
        }
        return Buffer.compare(Buffer.from(`${left.url}\0${left.pageId}`, 'utf8'), Buffer.from(`${right.url}\0${right.pageId}`, 'utf8'));
    });
}
function filterPages(rows: readonly MaterialPage[], query: PagesListQuery): MaterialPage[] {
    const needle = query.q?.normalize('NFKC').toLowerCase();
    return rows.filter((row) => (!needle || row.searchText.includes(needle)) &&
        (!query.insight || row.insights.includes(query.insight)) &&
        (!query.indexability || (query.indexability === 'indexable' ? row.isIndexable === true : row.isIndexable === false)) &&
        (!query.visibility || (query.visibility === 'measured' ? row.performanceSource !== null : row.performanceSource === null)));
}
function queryFingerprint(accountId: string, siteId: string, query: PagesListQuery, direction: 'asc' | 'desc'): string {
    return hash(JSON.stringify({ accountId, siteId, range: query.range, q: query.q ?? null, insight: query.insight ?? null, indexability: query.indexability ?? null, visibility: query.visibility ?? null, sort: query.sort, direction, limit: query.limit }));
}
function cursorKey(secret: string): Buffer {
    return createHmac('sha256', secret).update('pages-cursor:v1', 'utf8').digest();
}
function signCursor(payload: CursorPayload, secret: string): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', cursorKey(secret)).update(body).digest('base64url');
    return `${body}.${signature}`;
}
function parseCursor(value: string, secret: string, expectedQuery: string, expectedInventory: string, now: Date): CursorPayload {
    try {
        const [body, signature, extra] = value.split('.');
        if (!body || !signature || extra)
            throw new Error('shape');
        const expected = createHmac('sha256', cursorKey(secret)).update(body).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (actual.toString('base64url') !== signature || actual.length !== expected.length || !timingSafeEqual(actual, expected))
            throw new Error('signature');
        const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<CursorPayload>;
        if (parsed.v !== 1 || parsed.q !== expectedQuery || parsed.i !== expectedInventory ||
            typeof parsed.n !== 'boolean' ||
            (parsed.p !== null && typeof parsed.p !== 'string' && (typeof parsed.p !== 'number' || !Number.isFinite(parsed.p))) ||
            typeof parsed.u !== 'string' || typeof parsed.id !== 'string' ||
            typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number' || parsed.exp <= now.getTime() || parsed.iat > now.getTime())
            throw new Error('binding');
        return parsed as CursorPayload;
    }
    catch {
        throw new PagesError(400, 'PAGES_INVALID_CURSOR', 'pages.errors.invalidCursor');
    }
}
export function createPagesService(deps: PagesServiceDeps): PagesService {
    const now = deps.now ?? (() => new Date());
    const repository = deps.repository ?? createPagesRepository(deps.db, { now });
    const loadSite = deps.loadSite ?? (async (accountId, siteId) => {
        try {
            const site = await loadOwnedSite(accountId, siteId, { allowPaused: true });
            return { id: String(site._id), url: site.url, domain: site.domain };
        }
        catch {
            throw new PagesError(404, 'PAGES_SITE_NOT_FOUND', 'pages.errors.siteNotFound');
        }
    });
    const resolveGsc = deps.resolveGscState ?? resolveStoredPagesGscState;
    const readAudit = deps.readAudit ?? ((accountId, siteId) => readLatestCompletedPageInventory(accountId, siteId));
    async function fallbackMaterial(accountId: string, site: SiteShape, range: PagesRange, gscState: StoredPagesGscState): Promise<SourceMaterial> {
        const market = await resolvePagesFallbackMarket(deps.db, accountId, site.id);
        const source = deps.providerSelection === 'fake' ? 'demo' : 'dataforseo';
        const latest = await repository.readLatest({ accountId, siteId: site.id, source, ...market });
        const audit = await readAudit(accountId, site.id);
        const coverage = emptyCoverage(latest ? source : 'none');
        coverage.auditRowsFetched = audit.fetchedCount;
        coverage.auditTruncated = audit.truncated;
        if (!latest) {
            const pages = new Map<string, MaterialPage>();
            mergeAudit(pages, audit, site.url, coverage);
            const finished = finishPages(pages, coverage);
            const status: PagesStatus = gscState.fallbackReason === 'gsc_not_connected' ? 'empty' : 'unavailable';
            return {
                site,
                envelope: {
                    source: 'none', status, fallbackReason: gscState.fallbackReason as PagesFallbackReason,
                    observedAt: null, staleAt: null, range, rangeSemantics: 'point_in_time',
                    comparison: { label: 'since_previous_sync', previousObservedAt: null },
                    market, coverage,
                },
                pages: finished,
                inventoryFingerprint: hash(JSON.stringify(['none', market, audit.runId])),
                sourceSnapshot: null,
                fallbackContext: market,
                auditRunId: audit.runId,
            };
        }
        const previous = await repository.readPrevious({ accountId, siteId: site.id, source, ...market, beforeObservedAt: latest.observedAt, beforeSnapshotId: latest.id });
        const horizon = new Date(latest.observedAt.getTime() - rangeDays(range) * DAY_MS);
        const comparable = previous && previous.observedAt >= horizon ? previous : null;
        const [currentRows, previousRows] = await Promise.all([
            repository.readKeywords({ accountId, siteId: site.id, snapshotId: latest.id, limit: 100 }),
            comparable ? repository.readKeywords({ accountId, siteId: site.id, snapshotId: comparable.id, limit: 100 }) : Promise.resolve([]),
        ]);
        Object.assign(coverage, {
            sourceRowsFetched: latest.sourceRowsFetched,
            sourceRowsAccepted: latest.acceptedCount,
            sourceRowsDropped: latest.droppedCount,
            dropped: { malformedUrl: latest.malformedUrlCount, offsiteUrl: latest.offsiteUrlCount, duplicateUrl: latest.duplicateUrlCount, invalidMetric: latest.invalidMetricCount },
            sourceTruncated: latest.sourceTruncated,
        });
        const currentGroups = groupByPageHash(currentRows);
        const previousGroups = groupByPageHash(previousRows);
        const pages = new Map<string, MaterialPage>();
        for (const [pageId, rows] of currentGroups) {
            const metrics = aggregateFallback(rows);
            const previousMetrics = previousGroups.has(pageId) ? aggregateFallback(previousGroups.get(pageId)!) : null;
            const associated = associatedFallback(rows).sort((left, right) => (right.estimatedTraffic ?? Number.NEGATIVE_INFINITY) - (left.estimatedTraffic ?? Number.NEGATIVE_INFINITY) ||
                (right.searchVolume ?? Number.NEGATIVE_INFINITY) - (left.searchVolume ?? Number.NEGATIVE_INFINITY) || left.query.localeCompare(right.query));
            pages.set(pageId, {
                pageId, url: rows[0]!.canonicalUrl, displayUrl: rows[0]!.displayUrl, title: null,
                performanceSource: source, isIndexable: null, nonIndexableReason: null, onPageScore: null,
                metrics, deltas: deltas(metrics, previousMetrics), insights: [], associated,
                searchText: '', weight: metrics.searchVolume ?? rows.length, previousClicks: null,
            });
        }
        mergeAudit(pages, audit, site.url, coverage);
        const finished = finishPages(pages, coverage);
        const status = fallbackStatus(latest, now());
        return {
            site,
            envelope: {
                source, status, fallbackReason: gscState.fallbackReason as PagesFallbackReason,
                observedAt: latest.observedAt.toISOString(),
                staleAt: new Date(latest.cacheFetchedAt.getTime() + SITE_RANKED_KEYWORD_CACHE_TTL_MS).toISOString(),
                range, rangeSemantics: 'point_in_time',
                comparison: { label: 'since_previous_sync', previousObservedAt: comparable?.observedAt.toISOString() ?? null },
                market, coverage,
            },
            pages: finished,
            inventoryFingerprint: hash(JSON.stringify([source, latest.id, audit.runId])),
            sourceSnapshot: latest,
            fallbackContext: market,
            auditRunId: audit.runId,
        };
    }
    async function gscMaterial(accountId: string, site: SiteShape, range: PagesRange, gscState: StoredPagesGscState): Promise<SourceMaterial> {
        const windowDays = rangeDays(range);
        const key = {
            accountId,
            siteId: site.id,
            dimensionSet: 'page' as const,
            windowDays,
            bindingGenerationId: gscState.bindingGenerationId ?? 'legacy',
        };
        const [latest, syncRun, audit] = await Promise.all([
            readLatestPagesGscSnapshot(deps.db, key),
            readLatestGscSyncRun(deps.db, { accountId, siteId: site.id, propertyUrlHash: gscState.propertyUrlHash!, bindingGenerationId: gscState.bindingGenerationId ?? 'legacy' }),
            readAudit(accountId, site.id),
        ]);
        const current = syncRun?.status === 'empty' && (!latest || syncRun.snapshotDate === null || syncRun.snapshotDate >= latest.snapshotDate) ? null : latest;
        const querySnapshot = current
            ? await readPagesGscSnapshotAtDate(deps.db, { ...key, dimensionSet: 'query,page' }, current.snapshotDate)
            : null;
        const coverage = emptyCoverage('gsc');
        coverage.auditRowsFetched = audit.fetchedCount;
        coverage.auditTruncated = audit.truncated;
        let status: PagesStatus;
        if (!current) {
            status = syncRun?.status === 'empty' ? 'empty' : syncRun?.status === 'failed' ? 'unavailable' : 'syncing';
        }
        else if ((syncRun?.status === 'failed' &&
            (syncRun.completedAt ?? syncRun.startedAt).getTime() >= current.fetchedAt.getTime()) ||
            now().getTime() >= current.fetchedAt.getTime() + GSC_STALE_MS) {
            status = 'stale';
        }
        else {
            status = 'ready';
        }
        const previous = current ? await readPreviousPagesGscSnapshot(deps.db, { ...key, beforeDate: current.snapshotDate }) : null;
        const pages = new Map<string, MaterialPage>();
        let malformed = 0;
        let offsite = 0;
        const currentGroups = new Map<string, {
            canonical: ReturnType<typeof canonicalizePageUrl> & {
                ok: true;
            };
            rows: GscSearchAnalyticsSnapshotRow[];
        }>();
        for (const row of current?.rows ?? []) {
            const canonical = canonicalizePageUrl(row.dimensionKey, site.url);
            if (!canonical.ok) {
                if (canonical.reason === 'malformed_url')
                    malformed += 1;
                else
                    offsite += 1;
                continue;
            }
            const group = currentGroups.get(canonical.value.pageHash) ?? { canonical, rows: [] };
            group.rows.push(row);
            currentGroups.set(canonical.value.pageHash, group);
        }
        const previousGroups = new Map<string, GscSearchAnalyticsSnapshotRow[]>();
        for (const row of previous?.rows ?? []) {
            const canonical = canonicalizePageUrl(row.dimensionKey, site.url);
            if (!canonical.ok)
                continue;
            const group = previousGroups.get(canonical.value.pageHash) ?? [];
            group.push(row);
            previousGroups.set(canonical.value.pageHash, group);
        }
        const associatedGroups = new Map<string, GscSearchAnalyticsSnapshotRow[]>();
        for (const row of querySnapshot?.rows ?? []) {
            const parts = row.dimensionKey.split(GSC_SEPARATOR);
            const canonical = canonicalizePageUrl(parts[1] ?? '', site.url);
            if (!canonical.ok)
                continue;
            const group = associatedGroups.get(canonical.value.pageHash) ?? [];
            group.push(row);
            associatedGroups.set(canonical.value.pageHash, group);
        }
        for (const [pageId, group] of currentGroups) {
            const metrics = aggregateGsc(group.rows);
            const previousMetrics = previousGroups.has(pageId) ? aggregateGsc(previousGroups.get(pageId)!) : null;
            const associated = associatedGsc(associatedGroups.get(pageId) ?? []);
            metrics.associatedQueryCount = associated.length;
            pages.set(pageId, {
                pageId, url: group.canonical.value.canonicalUrl, displayUrl: group.canonical.value.displayUrl,
                title: null, performanceSource: 'gsc', isIndexable: null, nonIndexableReason: null, onPageScore: null,
                metrics, deltas: deltas(metrics, previousMetrics), insights: [], associated,
                searchText: '', weight: metrics.impressions!,
                previousClicks: previousMetrics?.clicks ?? null,
            });
        }
        coverage.sourceRowsAccepted = current?.rows.length ? current.rows.length - malformed - offsite : 0;
        coverage.sourceRowsDropped = malformed + offsite;
        coverage.dropped.malformedUrl = malformed;
        coverage.dropped.offsiteUrl = offsite;
        coverage.sourceTruncated = (current?.rows.length ?? 0) >= 1000 || (querySnapshot?.rows.length ?? 0) >= 1000;
        mergeAudit(pages, audit, site.url, coverage);
        const finished = finishPages(pages, coverage);
        return {
            site,
            envelope: {
                source: 'gsc', status, fallbackReason: null,
                observedAt: current?.fetchedAt.toISOString() ?? syncRun?.lastSuccessAt?.toISOString() ?? null,
                staleAt: current ? new Date(current.fetchedAt.getTime() + GSC_STALE_MS).toISOString() : null,
                range, rangeSemantics: 'rolling_window',
                comparison: { label: 'since_previous_sync', previousObservedAt: previous?.fetchedAt.toISOString() ?? null },
                market: null, coverage,
            },
            pages: finished,
            inventoryFingerprint: hash(JSON.stringify(['gsc', current?.snapshotDate ?? syncRun?.generation ?? null, querySnapshot?.snapshotDate ?? null, audit.runId])),
            sourceSnapshot: current,
            fallbackContext: null,
            auditRunId: audit.runId,
        };
    }
    async function materialize(accountId: string, siteId: string, range: PagesRange): Promise<SourceMaterial> {
        const site = await loadSite(accountId, siteId);
        const gscState = await resolveGsc(accountId, site.id, site.url);
        return gscState.usable
            ? gscMaterial(accountId, site, range, gscState)
            : fallbackMaterial(accountId, site, range, gscState);
    }
    async function list(accountId: string, siteId: string, query: PagesListQuery): Promise<PagesListResponse> {
        const started = now().getTime();
        const material = await materialize(accountId, siteId, query.range);
        const direction = query.direction ?? DEFAULT_PAGES_DIRECTIONS[query.sort];
        const filtered = sortPages(filterPages(material.pages, query), query.sort, direction);
        const qFingerprint = queryFingerprint(accountId, siteId, query, direction);
        let offset = 0;
        if (query.cursor) {
            const cursor = parseCursor(query.cursor, deps.cursorSecret, qFingerprint, material.inventoryFingerprint, now());
            const index = filtered.findIndex((row) => row.pageId === cursor.id);
            const anchor = filtered[index];
            const anchorPrimary = anchor ? primary(anchor, query.sort) : null;
            if (index < 0 || !anchor || anchor.url !== cursor.u || anchorPrimary !== cursor.p || cursor.n !== (anchorPrimary === null)) {
                throw new PagesError(400, 'PAGES_INVALID_CURSOR', 'pages.errors.invalidCursor');
            }
            offset = index + 1;
        }
        const slice = filtered.slice(offset, offset + query.limit + 1);
        const hasNext = slice.length > query.limit;
        const items = slice.slice(0, query.limit);
        const anchor = items.at(-1);
        const currentNow = now().getTime();
        const nextCursor = hasNext && anchor
            ? signCursor({ v: 1, q: qFingerprint, i: material.inventoryFingerprint, n: primary(anchor, query.sort) === null, p: primary(anchor, query.sort), u: anchor.url, id: anchor.pageId, iat: currentNow, exp: currentNow + CURSOR_TTL_MS }, deps.cursorSecret)
            : null;
        deps.telemetry?.('pages.read.completed', {
            source: material.envelope.source, status: material.envelope.status, range: query.range,
            cache: materialCacheState(material),
            acceptedRows: material.envelope.coverage.sourceRowsAccepted,
            droppedRows: material.envelope.coverage.sourceRowsDropped,
            durationMs: now().getTime() - started,
        });
        return {
            envelope: material.envelope,
            summary: summaryFor(filtered, material.envelope.source),
            items: items.map(publicPage),
            pageInfo: {
                limit: query.limit as 25 | 50 | 100,
                hasNext,
                nextCursor,
                totalFiltered: filtered.length,
                totalInventory: material.pages.length,
                totalMeasured: material.pages.filter((row) => row.performanceSource !== null).length,
            },
        };
    }
    async function detail(accountId: string, siteId: string, pageId: string, range: PagesRange): Promise<PagesDetailResponse> {
        const started = now().getTime();
        const material = await materialize(accountId, siteId, range);
        const page = material.pages.find((row) => row.pageId === pageId);
        if (!page)
            throw new PagesError(404, 'PAGES_PAGE_NOT_FOUND', 'pages.errors.pageNotFound');
        const total = page.associated.length;
        const trend: TrendPoint[] = [];
        if (material.envelope.source === 'gsc' && material.sourceSnapshot && 'snapshotDate' in material.sourceSnapshot) {
            const source = material.sourceSnapshot as PagesGscSnapshot;
            const history = await readPagesGscHistory(deps.db, {
                accountId, siteId, dimensionSet: 'page', windowDays: rangeDays(range),
                since: isoDate(new Date(source.fetchedAt.getTime() - rangeDays(range) * DAY_MS)), until: source.snapshotDate, limit: 90,
            });
            for (const point of history) {
                const rows = point.rows.filter((row) => {
                    const canonical = canonicalizePageUrl(row.dimensionKey, material.site.url);
                    return canonical.ok && canonical.value.pageHash === pageId;
                });
                if (rows.length)
                    trend.push({ observedAt: point.fetchedAt.toISOString(), source: 'gsc', range, market: null, metrics: aggregateGsc(rows) });
            }
        }
        else if ((material.envelope.source === 'dataforseo' || material.envelope.source === 'demo') && material.sourceSnapshot && material.fallbackContext) {
            const snapshot = material.sourceSnapshot as PagePerformanceSnapshot;
            const history = await repository.readRange({
                accountId, siteId, source: material.envelope.source, ...material.fallbackContext,
                from: new Date(snapshot.observedAt.getTime() - rangeDays(range) * DAY_MS), to: snapshot.observedAt,
            });
            for (const point of history.slice(-90)) {
                const rows = await repository.readKeywords({ accountId, siteId, snapshotId: point.id, pageHash: pageId, limit: 100 });
                if (rows.length)
                    trend.push({ observedAt: point.observedAt.toISOString(), source: material.envelope.source, range, market: material.envelope.market, metrics: aggregateFallback(rows) });
            }
        }
        const response: PagesDetailResponse = {
            envelope: material.envelope,
            page: publicPage(page),
            associated: { kind: page.performanceSource === 'gsc' ? 'queries' : page.performanceSource ? 'keywords' : 'none', rows: page.associated.slice(0, 100), total, truncated: total > 100 },
            trend: trend.slice(-90),
        };
        deps.telemetry?.('pages.read.completed', {
            operation: 'detail',
            source: material.envelope.source,
            status: material.envelope.status,
            range,
            cache: materialCacheState(material),
            acceptedRows: material.envelope.coverage.sourceRowsAccepted,
            droppedRows: material.envelope.coverage.sourceRowsDropped,
            durationMs: now().getTime() - started,
        });
        return response;
    }
    async function refresh(accountId: string, siteId: string): Promise<PagesRefreshResponse> {
        const started = now().getTime();
        const site = await loadSite(accountId, siteId);
        const gscState = await resolveGsc(accountId, site.id, site.url);
        deps.telemetry?.('pages.refresh.started', {
            source: gscState.usable ? 'gsc' : deps.providerSelection === 'fake' ? 'demo' : 'dataforseo',
            range: '28d',
            cache: 'not_started',
        });
        if (gscState.usable) {
            if (!deps.syncGsc || !gscState.propertyUrlHash) {
                deps.telemetry?.('pages.refresh.failed', { source: 'gsc', status: 'unavailable', range: '28d', cache: 'not_applicable', acceptedRows: 0, droppedRows: 0, errorClass: 'sync_unconfigured', durationMs: now().getTime() - started });
                throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable');
            }
            let result: Awaited<ReturnType<NonNullable<PagesServiceDeps['syncGsc']>>>;
            try {
                result = await deps.syncGsc({ accountId, siteId, domain: site.domain, propertyUrlHash: gscState.propertyUrlHash, bindingGenerationId: gscState.bindingGenerationId ?? 'legacy' });
            }
            catch (error) {
                const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
                state.envelope.status = state.items.length ? 'stale' : 'unavailable';
                deps.telemetry?.('pages.refresh.failed', {
                    source: 'gsc',
                    status: state.envelope.status,
                    range: '28d',
                    cache: 'not_applicable',
                    acceptedRows: state.envelope.coverage.sourceRowsAccepted,
                    droppedRows: state.envelope.coverage.sourceRowsDropped,
                    errorClass: error instanceof Error ? error.name : 'unknown',
                    durationMs: now().getTime() - started,
                });
                throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable', undefined, state.items.length ? state : undefined);
            }
            if (result.status !== 'ok' && result.status !== 'no-data') {
                const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
                state.envelope.status = state.items.length ? 'stale' : 'unavailable';
                deps.telemetry?.('pages.refresh.failed', { source: 'gsc', status: state.envelope.status, range: '28d', cache: 'not_applicable', acceptedRows: state.envelope.coverage.sourceRowsAccepted, droppedRows: state.envelope.coverage.sourceRowsDropped, errorClass: result.status, durationMs: now().getTime() - started });
                throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable', undefined, state.items.length ? state : undefined);
            }
            const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
            if (result.status === 'no-data')
                state.envelope.status = 'empty';
            const observedAt = state.envelope.observedAt ?? now().toISOString();
            deps.telemetry?.('pages.refresh.completed', { source: 'gsc', status: state.envelope.status, range: '28d', cache: 'not_applicable', acceptedRows: state.envelope.coverage.sourceRowsAccepted, droppedRows: state.envelope.coverage.sourceRowsDropped, durationMs: now().getTime() - started });
            return { refresh: { outcome: result.status === 'no-data' ? 'empty' : 'refreshed', source: 'gsc', cache: 'not_applicable', observedAt }, state };
        }
        let result: Awaited<ReturnType<PagesFallbackRefreshService['refresh']>>;
        try {
            result = await deps.fallbackRefresh.refresh({ accountId, siteId, domain: site.domain, siteUrl: site.url });
        }
        catch (error) {
            deps.telemetry?.('pages.refresh.failed', {
                source: deps.providerSelection === 'fake' ? 'demo' : 'dataforseo',
                status: 'unavailable',
                range: '28d',
                cache: 'not_started',
                acceptedRows: 0,
                droppedRows: 0,
                errorClass: error instanceof Error ? error.name : 'unknown',
                durationMs: now().getTime() - started,
            });
            throw error;
        }
        if (!result.ok) {
            const state = result.lastGood ? await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 }) : undefined;
            if (state)
                state.envelope.status = 'stale';
            const providerFailure = result.failure === 'provider_unavailable';
            const failedStatus = state ? state.envelope.status : 'unavailable';
            deps.telemetry?.('pages.refresh.failed', { source: result.source, status: failedStatus, range: '28d', cache: 'unknown', acceptedRows: 0, droppedRows: 0, errorClass: result.failure, durationMs: now().getTime() - started });
            throw new PagesError(503, providerFailure ? 'PAGES_PROVIDER_UNAVAILABLE' : 'PAGES_REFRESH_FAILED', providerFailure ? 'pages.errors.providerUnavailable' : 'pages.errors.refreshFailed', undefined, state);
        }
        const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
        deps.telemetry?.('pages.refresh.completed', { source: result.source, status: state.envelope.status, range: '28d', cache: result.cache, acceptedRows: result.coverage.acceptedCount, droppedRows: result.coverage.droppedCount, durationMs: now().getTime() - started });
        return { refresh: { outcome: result.outcome, source: result.source, cache: result.cache, observedAt: result.observedAt.toISOString() }, state };
    }
    return { list, detail, refresh };
}
