import { z } from 'zod';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBlockV1, type ReportDocumentV1, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAccessContext, ReportExportAdapter, } from '../report-exports/index.js';
import { assertSiteResourceTarget } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getLandscapeRun } from './landscape/landscape.repository.js';
import { LANDSCAPE_CLASSES, type LandscapeClass, type LandscapeReportRow, } from './landscape/landscape.schemas.js';
const selectionSchema = z
    .object({
    class: z.array(z.enum(LANDSCAPE_CLASSES)).max(LANDSCAPE_CLASSES.length).optional(),
    competitor: z.array(z.string().trim().min(1).max(253)).max(10).optional(),
    query: z.string().trim().max(200).optional(),
    opportunity: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
    accepted: z.enum(['accepted', 'unaccepted', 'all']).default('all'),
})
    .strict();
type Selection = z.infer<typeof selectionSchema>;
type LandscapeDetail = Awaited<ReturnType<typeof getLandscapeRun>>;
type LandscapeManifest = NonNullable<LandscapeDetail['manifest']>;
type LandscapeOpportunity = LandscapeManifest['opportunities'][number];
type LandscapeSuggestion = LandscapeManifest['pageSuggestions'][number];
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
const CLASS_ORDER: Record<LandscapeClass, number> = {
    missing: 0,
    shared_behind: 1,
    shared_even: 2,
    shared_ahead: 3,
    owned_only: 4,
};
function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort(stableSortText);
}
function boundedList(values: readonly string[]): string {
    const sorted = uniqueSorted(values);
    const joined = sorted.join(', ');
    return joined.length <= 900
        ? joined
        : `${sorted.length}; ${reportSourceVersion('landscape-selection', sorted)}`;
}
function compareNullableDescending(left: number | null, right: number | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return right - left;
}
function compareRows(left: LandscapeReportRow, right: LandscapeReportRow): number {
    return (CLASS_ORDER[left.class] - CLASS_ORDER[right.class] ||
        right.competitorCoverage - left.competitorCoverage ||
        compareNullableDescending(left.searchVolume, right.searchVolume) ||
        compareNullableDescending(left.positionDelta, right.positionDelta) ||
        stableSortText(`${left.normalizedKeyword}\0${left.competitorDomain}`, `${right.normalizedKeyword}\0${right.competitorDomain}`));
}
function acceptedActionId(opportunity: LandscapeOpportunity): string | null {
    return (opportunity as LandscapeOpportunity & {
        acceptedActionId?: string | null;
    })
        .acceptedActionId ?? null;
}
function suggestionReview(suggestion: LandscapeSuggestion): {
    state: 'unreviewed' | 'approved' | 'rejected';
    ownedUrl: string | null;
    competitorUrl: string | null;
    reviewedAt: string | null;
} {
    return (suggestion as LandscapeSuggestion & {
        review?: {
            state: 'unreviewed' | 'approved' | 'rejected';
            ownedUrl: string | null;
            competitorUrl: string | null;
            reviewedAt: string | null;
        };
    }).review ?? {
        state: 'unreviewed',
        ownedUrl: null,
        competitorUrl: null,
        reviewedAt: null,
    };
}
function highestConfidence(opportunities: readonly LandscapeOpportunity[]): 'high' | 'medium' | 'low' | null {
    return opportunities.reduce<'high' | 'medium' | 'low' | null>((current, item) => {
        if (current === null || CONFIDENCE_ORDER[item.confidence] > CONFIDENCE_ORDER[current]) {
            return item.confidence;
        }
        return current;
    }, null);
}
function actionState(opportunities: readonly LandscapeOpportunity[]): 'accepted' | 'unaccepted' | 'not_applicable' {
    if (opportunities.some((item) => acceptedActionId(item) !== null))
        return 'accepted';
    return opportunities.length > 0 ? 'unaccepted' : 'not_applicable';
}
function compareOpportunities(left: LandscapeOpportunity, right: LandscapeOpportunity): number {
    return (stableSortText(left.kind, right.kind) ||
        stableSortText(left.id, right.id));
}
function compareSuggestions(manifest: LandscapeManifest, left: LandscapeSuggestion, right: LandscapeSuggestion): number {
    return (stableSortText(competitorDomain(manifest, left.competitorProfileId), competitorDomain(manifest, right.competitorProfileId)) ||
        stableSortText(left.competitorUrl, right.competitorUrl) ||
        stableSortText(left.ownedUrl, right.ownedUrl));
}
function compareWarnings(manifest: LandscapeManifest, left: LandscapeManifest['warnings'][number], right: LandscapeManifest['warnings'][number]): number {
    return (stableSortText(left.code, right.code) ||
        stableSortText(left.leg ?? '', right.leg ?? '') ||
        stableSortText(competitorDomain(manifest, left.competitorProfileId), competitorDomain(manifest, right.competitorProfileId)));
}
async function loadSource(db: ApplicationDb, context: Pick<ReportExportAccessContext, 'accountId' | 'locale' | 'target'>) {
    assertSiteResourceTarget(context.target);
    const [detail, site] = await Promise.all([
        getLandscapeRun({
            accountId: context.accountId,
            siteId: context.target.siteId,
            runId: context.target.resourceId,
            db,
            locale: context.locale,
            pageLimit: 30,
            pageCursor: 0,
        }),
        getSite(context.accountId, context.target.siteId),
    ]);
    return { detail, siteLabel: site.displayName || site.domain };
}
function sourceVersion(source: Awaited<ReturnType<typeof loadSource>>): string {
    return reportSourceVersion('competitors.landscape_run', source);
}
function selectedOpportunities(manifest: LandscapeManifest, selection: Selection) {
    const requested = new Set(selection.opportunity ?? []);
    return [...manifest.opportunities]
        .filter((item) => requested.size === 0 || requested.has(item.id))
        .filter((item) => {
        if (selection.accepted === 'all')
            return true;
        const accepted = acceptedActionId(item) !== null;
        return selection.accepted === 'accepted' ? accepted : !accepted;
    })
        .sort(compareOpportunities);
}
function filterRows(detail: LandscapeDetail, manifest: LandscapeManifest, selection: Selection, opportunities: readonly LandscapeOpportunity[]): LandscapeReportRow[] {
    const classes = new Set(selection.class ?? []);
    const competitors = new Set(selection.competitor ?? []);
    const query = selection.query?.toLocaleLowerCase('en-US') ?? '';
    const selectedEvidence = new Set(opportunities.flatMap((item) => item.evidenceRowIds));
    const filterByOpportunity = (selection.opportunity?.length ?? 0) > 0 || selection.accepted !== 'all';
    const frozenCompetitors = new Set(manifest.competitors
        .filter((item) => competitors.size === 0 ||
        competitors.has(item.profileId) ||
        competitors.has(item.domain))
        .map((item) => item.profileId));
    return [...detail.rows]
        .filter((row) => classes.size === 0 || classes.has(row.class))
        .filter((row) => competitors.size === 0 || frozenCompetitors.has(row.competitorProfileId))
        .filter((row) => query.length === 0 ||
        row.keyword.toLocaleLowerCase('en-US').includes(query) ||
        row.normalizedKeyword.toLocaleLowerCase('en-US').includes(query))
        .filter((row) => !filterByOpportunity || selectedEvidence.has(row.id))
        .sort(compareRows);
}
function sourceDateId(provenanceIndex: number, manifest: LandscapeManifest): string {
    return manifest.provenance[provenanceIndex]?.capturedAt
        ? `landscape-observation-${provenanceIndex + 1}`
        : 'landscape-derived';
}
function observedAt(row: LandscapeReportRow, manifest: LandscapeManifest): string | null {
    for (const index of row.provenanceIndexes) {
        const capturedAt = manifest.provenance[index]?.capturedAt;
        if (capturedAt)
            return capturedAt;
    }
    return null;
}
function competitorDomain(manifest: LandscapeManifest, profileId: string | null): string {
    if (!profileId)
        return '';
    return manifest.competitors.find((item) => item.profileId === profileId)?.domain ?? '';
}
function landscapeRows(input: {
    manifest: LandscapeManifest;
    rows: readonly LandscapeReportRow[];
    opportunities: readonly LandscapeOpportunity[];
    selection: Selection;
}): ReportTableRowInput[] {
    const { manifest, rows, opportunities, selection } = input;
    const market = `${manifest.market.locationCode}/${manifest.market.languageCode}`;
    const allOpportunitiesByEvidence = new Map<string, LandscapeOpportunity[]>();
    for (const opportunity of manifest.opportunities) {
        for (const rowId of opportunity.evidenceRowIds) {
            const list = allOpportunitiesByEvidence.get(rowId) ?? [];
            list.push(opportunity);
            allOpportunitiesByEvidence.set(rowId, list);
        }
    }
    const records: ReportTableRowInput[] = rows.map((row) => {
        const linked = allOpportunitiesByEvidence.get(row.id) ?? [];
        const provenance = row.provenanceIndexes.flatMap((index) => {
            const entry = manifest.provenance[index];
            return entry
                ? [{ provider: entry.provider, operation: entry.operation, leg: entry.leg, status: entry.status }]
                : [];
        });
        return {
            values: [
                row.keyword,
                'keyword',
                market,
                row.competitorDomain,
                row.class,
                row.ownedPosition,
                row.competitorPosition,
                row.ownedUrl,
                row.competitorUrl,
                row.searchVolume,
                'provider_observation',
                observedAt(row, manifest),
                highestConfidence(linked),
                actionState(linked),
                stableReportJson({
                    keywordDifficulty: row.keywordDifficulty,
                    intent: row.intent,
                    positionDelta: row.positionDelta,
                    competitorCoverage: row.competitorCoverage,
                    provenance,
                }),
            ],
            sourceDateId: sourceDateId(row.provenanceIndexes[0] ?? -1, manifest),
        };
    });
    for (const rowClass of LANDSCAPE_CLASSES) {
        records.push({
            values: [
                rowClass,
                'class_rollup',
                market,
                '',
                rowClass,
                null,
                null,
                null,
                null,
                rows.filter((row) => row.class === rowClass).length,
                'derived',
                manifest.completedAt,
                null,
                'not_applicable',
                stableReportJson({
                    selectedRows: rows.filter((row) => row.class === rowClass).length,
                    storedRows: manifest.coverage.rowsByClass[rowClass],
                    requestedCompetitors: manifest.coverage.requestedCompetitors,
                    usableCompetitors: manifest.coverage.usableCompetitors,
                }),
            ],
            sourceDateId: 'landscape-derived',
        });
    }
    const selectedProfileIds = new Set(rows.map((row) => row.competitorProfileId));
    const selectedKeywords = new Set(rows.map((row) => row.normalizedKeyword));
    const hasRowSelection = (selection.class?.length ?? 0) > 0 ||
        (selection.competitor?.length ?? 0) > 0 ||
        (selection.query?.length ?? 0) > 0 ||
        (selection.opportunity?.length ?? 0) > 0 ||
        selection.accepted !== 'all';
    const suggestions = [...manifest.pageSuggestions]
        .filter((item) => (!hasRowSelection || selectedProfileIds.has(item.competitorProfileId)) &&
        (!hasRowSelection || item.keywordKeys.some((key) => selectedKeywords.has(key))))
        .sort((left, right) => compareSuggestions(manifest, left, right));
    for (const suggestion of suggestions) {
        const review = suggestionReview(suggestion);
        records.push({
            values: [
                boundedList(suggestion.keywordKeys),
                'page_suggestion',
                market,
                competitorDomain(manifest, suggestion.competitorProfileId),
                '',
                null,
                null,
                review.ownedUrl ?? suggestion.ownedUrl,
                review.competitorUrl ?? suggestion.competitorUrl,
                null,
                'derived',
                review.reviewedAt ?? manifest.completedAt,
                suggestion.confidence,
                review.state,
                stableReportJson({
                    suggestedCompetitorUrl: suggestion.competitorUrl,
                    suggestedOwnedUrl: suggestion.ownedUrl,
                    reasonCode: suggestion.reasonCode,
                    rubricVersion: suggestion.rubricVersion,
                }),
            ],
            sourceDateId: 'landscape-derived',
        });
    }
    for (const opportunity of opportunities) {
        records.push({
            values: [
                opportunity.title,
                'opportunity',
                market,
                boundedList(opportunity.competitorProfileIds.map((profileId) => competitorDomain(manifest, profileId))),
                opportunity.kind,
                null,
                null,
                null,
                null,
                null,
                'generated',
                manifest.completedAt,
                opportunity.confidence,
                acceptedActionId(opportunity) === null ? 'unaccepted' : 'accepted',
                stableReportJson({
                    recommendation: opportunity.recommendation,
                    keywordKeys: opportunity.keywordKeys,
                    labels: opportunity.labels,
                }),
            ],
            sourceDateId: 'landscape-generated',
        });
    }
    const selectedCompetitors = new Set(manifest.competitors
        .filter((item) => !selection.competitor ||
        selection.competitor.length === 0 ||
        selection.competitor.includes(item.profileId) ||
        selection.competitor.includes(item.domain))
        .map((item) => item.profileId));
    const warnings = [...manifest.warnings]
        .filter((item) => item.competitorProfileId === null || selectedCompetitors.has(item.competitorProfileId))
        .sort((left, right) => compareWarnings(manifest, left, right));
    for (const warning of warnings) {
        records.push({
            values: [
                warning.code,
                'partial_failure',
                market,
                competitorDomain(manifest, warning.competitorProfileId),
                '',
                null,
                null,
                null,
                null,
                warning.count,
                'derived',
                manifest.completedAt,
                null,
                'not_applicable',
                stableReportJson({ leg: warning.leg, retryable: false }),
            ],
            sourceDateId: 'landscape-derived',
        });
    }
    for (const error of [...manifest.errors].sort((left, right) => stableSortText(left.code, right.code))) {
        if (error.competitorProfileId && !selectedCompetitors.has(error.competitorProfileId))
            continue;
        records.push({
            values: [
                error.code,
                'error',
                market,
                competitorDomain(manifest, error.competitorProfileId),
                '',
                null,
                null,
                null,
                null,
                null,
                'derived',
                manifest.completedAt,
                null,
                'not_applicable',
                stableReportJson({ leg: error.leg, retryable: error.retryable }),
            ],
            sourceDateId: 'landscape-derived',
        });
    }
    manifest.provenance.forEach((entry, index) => {
        const owner = manifest.sourceDates[index];
        if (owner && !selectedCompetitors.has(owner.competitorProfileId))
            return;
        records.push({
            values: [
                `${entry.operation}/${entry.leg}`,
                'provenance',
                market,
                competitorDomain(manifest, owner?.competitorProfileId ?? null),
                '',
                null,
                null,
                null,
                null,
                entry.returnedRows,
                'provider_observation',
                entry.capturedAt,
                null,
                'not_applicable',
                stableReportJson({
                    provider: entry.provider,
                    cache: entry.cache,
                    status: entry.status,
                    targetOrder: entry.targetOrder,
                    itemTypes: entry.itemTypes,
                    limit: entry.limit,
                    truncated: entry.truncated,
                }),
            ],
            sourceDateId: sourceDateId(index, manifest),
        });
    });
    return records.map((record, index) => ({ ...record, id: `landscape-export-${index + 1}` }));
}
function sourceDates(locale: ReportDocumentV1['locale'], manifest: LandscapeManifest) {
    return [
        reportSourceDate({
            id: 'landscape-derived',
            label: reportCopy(locale, 'sources.storedDerived'),
            kind: 'derived',
            observedAt: manifest.completedAt,
            sourceNoteKey: 'competitors.landscape.derived',
            freshness: 'unknown',
        }),
        reportSourceDate({
            id: 'landscape-generated',
            label: reportCopy(locale, 'sources.storedGenerated'),
            kind: 'generated',
            observedAt: manifest.completedAt,
            sourceNoteKey: 'competitors.landscape.generated',
            freshness: 'unknown',
        }),
        ...manifest.provenance.flatMap((entry, index) => entry.capturedAt
            ? [
                reportSourceDate({
                    id: `landscape-observation-${index + 1}`,
                    label: `${reportCopy(locale, 'sources.competitorObservation')} ${index + 1}`,
                    kind: 'provider_observation',
                    observedAt: entry.capturedAt,
                    sourceNoteKey: 'competitors.landscape.observation',
                    freshness: entry.cache === 'hit' ? 'cached' : 'fresh',
                }),
            ]
            : []),
    ];
}
function table(locale: ReportDocumentV1['locale'], rows: readonly ReportTableRowInput[]) {
    return reportTable({
        id: 'competitor-landscape',
        columns: [
            { key: 'keyword', label: reportCopy(locale, 'fields.keyword'), valueType: 'string' },
            { key: 'recordType', label: reportCopy(locale, 'fields.recordType'), valueType: 'string' },
            { key: 'market', label: reportCopy(locale, 'fields.market'), valueType: 'string' },
            { key: 'competitor', label: reportCopy(locale, 'fields.competitor'), valueType: 'string' },
            { key: 'class', label: reportCopy(locale, 'fields.rowClass'), valueType: 'string' },
            { key: 'ownedPosition', label: reportCopy(locale, 'fields.ownedPosition'), valueType: 'number' },
            { key: 'competitorPosition', label: reportCopy(locale, 'fields.competitorPosition'), valueType: 'number' },
            { key: 'ownedUrl', label: reportCopy(locale, 'fields.ownedUrl'), valueType: 'url' },
            { key: 'competitorUrl', label: reportCopy(locale, 'fields.competitorUrl'), valueType: 'url' },
            { key: 'searchVolume', label: reportCopy(locale, 'fields.searchVolume'), valueType: 'number' },
            { key: 'sourceKind', label: reportCopy(locale, 'fields.sourceKind'), valueType: 'string' },
            { key: 'observedAt', label: reportCopy(locale, 'fields.observedAt'), valueType: 'date' },
            { key: 'confidence', label: reportCopy(locale, 'fields.confidence'), valueType: 'string' },
            { key: 'actionState', label: reportCopy(locale, 'fields.actionState'), valueType: 'string' },
            { key: 'details', label: reportCopy(locale, 'fields.details'), valueType: 'string' },
        ],
        rows,
    });
}
export function createCompetitorLandscapeReportExportAdapter(db: ApplicationDb): ReportExportAdapter<Selection> {
    return {
        kind: 'competitors.landscape_run',
        kindVersion: 1,
        supportedFormats: ['pdf', 'csv', 'json'],
        selectionSchema,
        async assertAccess(context) {
            const current = await loadSource(db, context);
            if (context.purpose === 'persist' &&
                context.sourceVersion &&
                context.sourceVersion !== sourceVersion(current)) {
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            }
        },
        async compose(context) {
            const source = await loadSource(db, context);
            const manifest = source.detail.manifest;
            if (!manifest)
                throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
            const opportunities = selectedOpportunities(manifest, context.selection);
            const rows = filterRows(source.detail, manifest, context.selection, opportunities);
            if (context.format === 'pdf' && rows.length > 1000) {
                throw new HttpError(422, { code: 'REPORT_EXPORTS_ERRORS_LANDSCAPE_PDF_TOO_LARGE', messageKey: 'reportExports.errors.landscapePdfTooLarge' }, {
                    selectedKeywordRows: rows.length,
                    maxKeywordRows: 1000,
                    alternatives: ['csv', 'json'],
                    narrowingFields: ['class', 'competitor', 'query', 'opportunity', 'accepted'],
                });
            }
            const selectedDomains = uniqueSorted(manifest.competitors
                .filter((item) => !context.selection.competitor ||
                context.selection.competitor.length === 0 ||
                context.selection.competitor.includes(item.profileId) ||
                context.selection.competitor.includes(item.domain))
                .map((item) => item.domain));
            const projectionRows = landscapeRows({
                manifest,
                rows,
                opportunities,
                selection: context.selection,
            });
            const dates = sourceDates(context.locale, manifest);
            const blocks: ReportBlockV1[] = [
                {
                    type: 'heading',
                    id: 'landscape-heading',
                    level: 2,
                    text: reportCopy(context.locale, 'sections.summary'),
                },
                table(context.locale, projectionRows),
                ...dates.map((date, index) => reportSourceNote({
                    id: `landscape-source-note-${index + 1}`,
                    sourceDateId: date.id,
                    methodology: reportCopy(context.locale, date.kind === 'provider_observation'
                        ? 'notes.competitorObservation'
                        : date.kind === 'generated'
                            ? 'notes.storedGenerated'
                            : 'notes.storedDerived'),
                    ...(index === 0 && manifest.coverage.failedLegs > 0
                        ? {
                            coverageWarning: `${reportCopy(context.locale, 'fields.warnings')}: ${manifest.coverage.failedLegs}`,
                        }
                        : {}),
                })),
            ];
            const document: ReportDocumentV1 = {
                schema: REPORT_DOCUMENT_SCHEMA,
                schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
                kind: 'competitors.landscape_run',
                kindVersion: 1,
                locale: context.locale,
                title: reportCatalogCopy(context.locale, 'competitorsLandscapeRun', 'title'),
                subject: [
                    { label: reportCopy(context.locale, 'fields.site'), value: source.siteLabel },
                    { label: reportCopy(context.locale, 'fields.market'), value: `${manifest.market.locationCode}/${manifest.market.languageCode}` },
                    { label: reportCopy(context.locale, 'fields.competitors'), value: boundedList(selectedDomains) },
                ],
                selection: [
                    { label: reportCopy(context.locale, 'fields.rowClass'), value: boundedList(context.selection.class ?? []) },
                    { label: reportCopy(context.locale, 'fields.competitors'), value: boundedList(selectedDomains) },
                    { label: reportCopy(context.locale, 'fields.query'), value: context.selection.query ?? '' },
                    { label: reportCopy(context.locale, 'fields.opportunities'), value: boundedList(opportunities.map((item) => item.title)) },
                    { label: reportCopy(context.locale, 'fields.actionState'), value: context.selection.accepted },
                ],
                sourceDates: dates,
                completeness: {
                    state: 'complete',
                    selectedItems: rows.length,
                    representedItems: rows.length,
                    bound: reportCatalogCopy(context.locale, 'competitorsLandscapeRun', 'bound'),
                },
                branding: context.branding,
                blocks,
                artifacts: [],
            };
            return { document, sourceVersion: sourceVersion(source) };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
export const competitorLandscapeReportExportTestables = {
    uniqueSorted,
    boundedList,
    compareNullableDescending,
    compareRows,
    acceptedActionId,
    suggestionReview,
    highestConfidence,
    actionState,
    compareOpportunities,
    compareSuggestions,
    compareWarnings,
    loadSource,
    sourceVersion,
    selectedOpportunities,
    filterRows,
    sourceDateId,
    observedAt,
    competitorDomain,
    landscapeRows,
    sourceDates,
    table,
};
