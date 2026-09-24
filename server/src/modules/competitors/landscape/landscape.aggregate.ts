import { createHash } from 'node:crypto';
import type { SupportedLocale } from '../../../shared/i18n/index.js';
import { LANDSCAPE_CLASSES, LANDSCAPE_LEGS, type FrozenCompetitor, type LandscapeClass, type LandscapeLeg, type LandscapeMarket, type LandscapeProvenance, type LandscapeReportManifest, type LandscapeReportRow, type NormalizedLandscapeRow, } from './landscape.schemas.js';
export interface LandscapeAggregationCheckpoint {
    competitorProfileId: string;
    leg: LandscapeLeg;
    state: 'pending' | 'dispatched' | 'succeeded' | 'failed';
    safeErrorCode: string | null;
    provenance: LandscapeProvenance | null;
    rows: readonly NormalizedLandscapeRow[];
}
export interface LandscapeAggregationInput {
    ownedDomain: string;
    locale: SupportedLocale;
    market: LandscapeMarket;
    competitors: readonly FrozenCompetitor[];
    checkpoints: readonly LandscapeAggregationCheckpoint[];
    completedAt: Date;
}
export interface LandscapeAggregationResult {
    rows: LandscapeReportRow[];
    manifest: LandscapeReportManifest;
    usableCompetitors: number;
    hasFailures: boolean;
}
const CLASS_ORDER: Record<LandscapeClass, number> = {
    missing: 0,
    shared_behind: 1,
    shared_even: 2,
    shared_ahead: 3,
    owned_only: 4,
};
function codePointCompare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
export function normalizeLandscapeKeyword(keyword: string): string {
    return keyword.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
function compareNullableNumberAscending(left: number | null, right: number | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return left - right;
}
function compareNullableNumberDescending(left: number | null, right: number | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return right - left;
}
function compareNullableString(left: string | null, right: string | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return codePointCompare(left, right);
}
function primaryPosition(row: NormalizedLandscapeRow, leg: LandscapeLeg): number | null {
    return leg === 'competitor_only' ? row.competitorPosition : row.ownedPosition;
}
function primaryUrl(row: NormalizedLandscapeRow, leg: LandscapeLeg): string | null {
    return leg === 'competitor_only' ? row.competitorUrl : row.ownedUrl;
}
/** Selects one whole observation using the public duplicate rubric. */
export function compareLandscapeObservations(left: NormalizedLandscapeRow, right: NormalizedLandscapeRow, leg: LandscapeLeg): number {
    return (compareNullableNumberAscending(primaryPosition(left, leg), primaryPosition(right, leg)) ||
        compareNullableString(primaryUrl(left, leg), primaryUrl(right, leg)) ||
        compareNullableNumberDescending(left.searchVolume, right.searchVolume) ||
        compareNullableNumberDescending(left.keywordDifficulty, right.keywordDifficulty) ||
        compareNullableString(left.intent, right.intent) ||
        codePointCompare(left.keyword, right.keyword));
}
export interface NormalizedLegRows {
    rows: NormalizedLandscapeRow[];
    duplicateKeys: number;
}
/** Revalidates normalization and de-duplicates at the feature seam. */
export function normalizeLandscapeLegRows(input: readonly NormalizedLandscapeRow[], leg: LandscapeLeg): NormalizedLegRows {
    const grouped = new Map<string, NormalizedLandscapeRow[]>();
    for (const row of input.slice(0, 100)) {
        const normalizedKeyword = normalizeLandscapeKeyword(row.keyword);
        if (normalizedKeyword.length === 0 || normalizedKeyword.length > 200)
            continue;
        const candidate = { ...row, normalizedKeyword };
        const group = grouped.get(normalizedKeyword) ?? [];
        group.push(candidate);
        grouped.set(normalizedKeyword, group);
    }
    let duplicateKeys = 0;
    const rows: NormalizedLandscapeRow[] = [];
    for (const group of grouped.values()) {
        if (group.length > 1)
            duplicateKeys += 1;
        group.sort((left, right) => compareLandscapeObservations(left, right, leg));
        const winner = group[0]!;
        const displayKeyword = group
            .map((row) => row.keyword)
            .sort(codePointCompare)[0]!;
        rows.push({ ...winner, keyword: displayKeyword });
    }
    rows.sort((left, right) => codePointCompare(left.normalizedKeyword, right.normalizedKeyword));
    return { rows, duplicateKeys };
}
export function classifyLandscapeRow(row: NormalizedLandscapeRow, leg: LandscapeLeg): LandscapeClass | null {
    if (leg === 'competitor_only') {
        return row.competitorPosition !== null && row.ownedPosition === null
            ? 'missing'
            : null;
    }
    if (leg === 'owned_only') {
        return row.ownedPosition !== null && row.competitorPosition === null
            ? 'owned_only'
            : null;
    }
    if (row.ownedPosition === null || row.competitorPosition === null)
        return null;
    const delta = row.ownedPosition - row.competitorPosition;
    if (delta > 0)
        return 'shared_behind';
    if (delta < 0)
        return 'shared_ahead';
    return 'shared_even';
}
function stableId(prefix: string, ...parts: readonly string[]): string {
    return `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex')}`;
}
interface CandidateRow {
    row: NormalizedLandscapeRow;
    class: LandscapeClass;
    competitor: FrozenCompetitor;
    provenanceIndex: number;
}
function compareReportRows(left: LandscapeReportRow, right: LandscapeReportRow): number {
    return (CLASS_ORDER[left.class] - CLASS_ORDER[right.class] ||
        right.competitorCoverage - left.competitorCoverage ||
        compareNullableNumberDescending(left.searchVolume, right.searchVolume) ||
        compareNullableNumberDescending(left.positionDelta, right.positionDelta) ||
        codePointCompare(`${left.normalizedKeyword}\0${left.competitorDomain}\0${left.competitorProfileId}`, `${right.normalizedKeyword}\0${right.competitorDomain}\0${right.competitorProfileId}`));
}
function buildSuggestions(rows: readonly LandscapeReportRow[]) {
    const byPair = new Map<string, {
        competitorProfileId: string;
        ownedUrl: string;
        competitorUrl: string;
        rows: LandscapeReportRow[];
    }>();
    for (const row of rows) {
        if (!row.class.startsWith('shared_') ||
            row.ownedUrl === null ||
            row.competitorUrl === null)
            continue;
        const key = `${row.competitorProfileId}\0${row.ownedUrl}\0${row.competitorUrl}`;
        const current = byPair.get(key) ?? {
            competitorProfileId: row.competitorProfileId,
            ownedUrl: row.ownedUrl,
            competitorUrl: row.competitorUrl,
            rows: [],
        };
        current.rows.push(row);
        byPair.set(key, current);
    }
    const perCompetitor = new Map<string, number>();
    return [...byPair.values()]
        .sort((left, right) => {
        const leftDemand = Math.max(...left.rows.map((row) => row.searchVolume ?? -1));
        const rightDemand = Math.max(...right.rows.map((row) => row.searchVolume ?? -1));
        return (right.rows.length - left.rows.length ||
            rightDemand - leftDemand ||
            codePointCompare(`${left.competitorProfileId}\0${left.ownedUrl}\0${left.competitorUrl}`, `${right.competitorProfileId}\0${right.ownedUrl}\0${right.competitorUrl}`));
    })
        .filter((pair) => {
        const count = perCompetitor.get(pair.competitorProfileId) ?? 0;
        if (count >= 10)
            return false;
        perCompetitor.set(pair.competitorProfileId, count + 1);
        return true;
    })
        .slice(0, 100)
        .map((pair) => {
        const keywordKeys = [...new Set(pair.rows.map((row) => row.normalizedKeyword))]
            .sort(codePointCompare)
            .slice(0, 20);
        const maxCoverage = Math.max(...pair.rows.map((row) => row.competitorCoverage));
        const closestDelta = Math.min(...pair.rows.map((row) => Math.abs(row.positionDelta!)));
        return {
            id: stableId('landscape-page', pair.competitorProfileId, pair.ownedUrl, pair.competitorUrl, ...keywordKeys),
            competitorProfileId: pair.competitorProfileId,
            ownedUrl: pair.ownedUrl,
            competitorUrl: pair.competitorUrl,
            keywordKeys,
            reasonCode: keywordKeys.length > 1
                ? ('highest_coverage' as const)
                : closestDelta <= 3
                    ? ('closest_rank' as const)
                    : ('same_keyword' as const),
            confidence: keywordKeys.length >= 2 || maxCoverage >= 2
                ? ('high' as const)
                : ('medium' as const),
            rubricVersion: '2026-08-08.1' as const,
        };
    });
}
function buildOpportunities(rows: readonly LandscapeReportRow[]): LandscapeReportManifest['opportunities'] {
    const actionable = rows.filter((row) => row.class === 'missing' ||
        (row.class === 'shared_behind' && row.ownedUrl !== null));
    const groups = new Map<string, LandscapeReportRow[]>();
    for (const row of actionable) {
        const groupKey = row.class === 'missing'
            ? `${row.class}\0${row.competitorProfileId}\0${row.intent ?? 'unknown'}`
            : `${row.class}\0${row.competitorProfileId}\0${row.ownedUrl!}`;
        const group = groups.get(groupKey) ?? [];
        group.push(row);
        groups.set(groupKey, group);
    }
    const perCompetitor = new Map<string, number>();
    return [...groups.entries()]
        .sort(([, left], [, right]) => compareReportRows(left[0]!, right[0]!))
        .filter(([, group]) => {
        const profileId = group[0]!.competitorProfileId;
        const count = perCompetitor.get(profileId) ?? 0;
        if (count >= 10)
            return false;
        perCompetitor.set(profileId, count + 1);
        return true;
    })
        .slice(0, 100)
        .map(([groupKey, group]) => {
        const first = group[0]!;
        const keywordKeys = [...new Set(group.map((row) => row.normalizedKeyword))]
            .sort(codePointCompare)
            .slice(0, 50);
        const evidenceRowIds = group.map((row) => row.id).sort(codePointCompare).slice(0, 50);
        const kind = first.class === 'missing'
            ? ('missing_keyword' as const)
            : ('ranking_deficit' as const);
        const titleKey = kind === 'missing_keyword'
            ? ('competitors.landscape.opportunities.missingTitle' as const)
            : ('competitors.landscape.opportunities.behindTitle' as const);
        const recommendationKey = kind === 'missing_keyword'
            ? ('competitors.landscape.opportunities.missingRecommendation' as const)
            : ('competitors.landscape.opportunities.behindRecommendation' as const);
        const recommendationVars: Record<string, string | number> = {
            count: keywordKeys.length,
        };
        if (kind === 'ranking_deficit')
            recommendationVars.url = first.ownedUrl!;
        return {
            id: stableId('landscape-opportunity', groupKey, ...evidenceRowIds),
            kind,
            titleKey,
            titleVars: { count: keywordKeys.length },
            recommendationKey,
            recommendationVars,
            competitorProfileIds: [first.competitorProfileId],
            keywordKeys,
            evidenceRowIds,
            confidence: first.competitorCoverage >= 2 || group.length >= 2
                ? ('high' as const)
                : first.searchVolume === null
                    ? ('low' as const)
                    : ('medium' as const),
            labels: {
                evidence: 'observed' as const,
                conclusion: 'derived' as const,
                prose: 'generated' as const,
            },
        };
    });
}
export function aggregateLandscape(input: LandscapeAggregationInput): LandscapeAggregationResult {
    const competitors = [...input.competitors].sort((left, right) => codePointCompare(left.profileId, right.profileId));
    const checkpoints = [...input.checkpoints].sort((left, right) => codePointCompare(left.competitorProfileId, right.competitorProfileId) ||
        LANDSCAPE_LEGS.indexOf(left.leg) - LANDSCAPE_LEGS.indexOf(right.leg));
    const provenance: LandscapeProvenance[] = [];
    const provenanceOwners: string[] = [];
    const warnings: LandscapeReportManifest['warnings'] = [];
    const errors: LandscapeReportManifest['errors'] = [];
    const candidates = new Map<string, Map<LandscapeLeg, CandidateRow>>();
    let unclassifiedSharedRows = 0;
    let succeededLegs = 0;
    let failedLegs = 0;
    let truncatedLegs = 0;
    for (const checkpoint of checkpoints) {
        if (checkpoint.provenance !== null) {
            provenanceOwners.push(checkpoint.competitorProfileId);
            provenance.push(checkpoint.provenance);
        }
        if (checkpoint.state !== 'succeeded' || checkpoint.provenance === null) {
            failedLegs += 1;
            const safeCode = checkpoint.safeErrorCode ?? 'LEG_FAILED';
            const warningCode = safeCode.startsWith('TIMEOUT')
                ? 'LEG_TIMEOUT'
                : safeCode.startsWith('MALFORMED')
                    ? 'LEG_MALFORMED'
                    : safeCode.startsWith('QUOTA')
                        ? 'LEG_QUOTA'
                        : 'LEG_FAILED';
            warnings.push({
                code: warningCode,
                competitorProfileId: checkpoint.competitorProfileId,
                leg: checkpoint.leg,
                count: 1,
            });
            errors.push({
                code: safeCode.replace(/[^A-Z0-9_]/g, '_').slice(0, 64) || 'LEG_FAILED',
                competitorProfileId: checkpoint.competitorProfileId,
                leg: checkpoint.leg,
                retryable: false,
            });
            continue;
        }
        succeededLegs += 1;
        const provenanceIndex = provenance.length - 1;
        if (checkpoint.provenance.truncated) {
            truncatedLegs += 1;
            warnings.push({
                code: 'LEG_TRUNCATED',
                competitorProfileId: checkpoint.competitorProfileId,
                leg: checkpoint.leg,
                count: 1,
            });
        }
        const normalized = normalizeLandscapeLegRows(checkpoint.rows, checkpoint.leg);
        if (normalized.duplicateKeys > 0) {
            warnings.push({
                code: 'DUPLICATE_LEG_CONFLICT',
                competitorProfileId: checkpoint.competitorProfileId,
                leg: checkpoint.leg,
                count: normalized.duplicateKeys,
            });
        }
        const competitor = competitors.find((item) => item.profileId === checkpoint.competitorProfileId);
        if (!competitor)
            continue;
        for (const row of normalized.rows) {
            const classification = classifyLandscapeRow(row, checkpoint.leg);
            if (classification === null) {
                if (checkpoint.leg === 'shared')
                    unclassifiedSharedRows += 1;
                continue;
            }
            const key = `${competitor.profileId}\0${row.normalizedKeyword}`;
            const byLeg = candidates.get(key) ?? new Map<LandscapeLeg, CandidateRow>();
            const candidate = { row, class: classification, competitor, provenanceIndex };
            byLeg.set(checkpoint.leg, candidate);
            candidates.set(key, byLeg);
        }
    }
    if (unclassifiedSharedRows > 0) {
        warnings.push({
            code: 'SHARED_POSITION_MISSING',
            competitorProfileId: null,
            leg: 'shared',
            count: unclassifiedSharedRows,
        });
    }
    const chosen: CandidateRow[] = [];
    for (const byLeg of candidates.values()) {
        const winner = byLeg.get('shared') ?? byLeg.get('competitor_only') ?? byLeg.get('owned_only');
        chosen.push(winner!);
    }
    const coverageByClassKey = new Map<string, Set<string>>();
    for (const candidate of chosen) {
        const key = `${candidate.class}\0${candidate.row.normalizedKeyword}`;
        const profiles = coverageByClassKey.get(key) ?? new Set<string>();
        profiles.add(candidate.competitor.profileId);
        coverageByClassKey.set(key, profiles);
    }
    const rows = chosen.map(({ row, class: rowClass, competitor, provenanceIndex }) => ({
        id: stableId('landscape-row', competitor.profileId, row.normalizedKeyword, rowClass),
        ...row,
        class: rowClass,
        competitorProfileId: competitor.profileId,
        competitorDomain: competitor.domain,
        positionDelta: rowClass.startsWith('shared_') &&
            row.ownedPosition !== null &&
            row.competitorPosition !== null
            ? row.ownedPosition - row.competitorPosition
            : null,
        competitorCoverage: coverageByClassKey.get(`${rowClass}\0${row.normalizedKeyword}`)!.size,
        provenanceIndexes: [provenanceIndex],
    } satisfies LandscapeReportRow));
    rows.sort(compareReportRows);
    const usableProfileIds = new Set(checkpoints
        .filter((checkpoint) => checkpoint.state === 'succeeded')
        .map((checkpoint) => checkpoint.competitorProfileId));
    for (const competitor of competitors) {
        const competitorCheckpoints = checkpoints.filter((checkpoint) => checkpoint.competitorProfileId === competitor.profileId);
        if (competitorCheckpoints.some((checkpoint) => checkpoint.state !== 'succeeded')) {
            warnings.push({
                code: 'PARTIAL_COMPETITOR',
                competitorProfileId: competitor.profileId,
                leg: null,
                count: competitorCheckpoints.filter((checkpoint) => checkpoint.state !== 'succeeded').length,
            });
        }
    }
    const rowsByClass = Object.fromEntries(LANDSCAPE_CLASSES.map((rowClass) => [
        rowClass,
        rows.filter((row) => row.class === rowClass).length,
    ])) as Record<LandscapeClass, number>;
    const sourceDates = provenance.map((entry, index) => ({
        competitorProfileId: provenanceOwners[index]!,
        leg: entry.leg,
        capturedAt: entry.capturedAt,
    }));
    const pageSuggestions = buildSuggestions(rows);
    const opportunities = buildOpportunities(rows);
    const pageCount = Math.ceil(rows.length / 100);
    const manifest: LandscapeReportManifest = {
        reportVersion: 1,
        schemaVersion: 'competitor-landscape/1',
        taxonomyVersion: '2026-08-08.1',
        ownedDomain: input.ownedDomain,
        locale: input.locale,
        market: input.market,
        competitors,
        coverage: {
            requestedCompetitors: competitors.length,
            usableCompetitors: usableProfileIds.size,
            requestedLegs: competitors.length * 3,
            succeededLegs,
            failedLegs,
            truncatedLegs,
            unclassifiedSharedRows,
            rowsByClass,
        },
        provenance,
        warnings: warnings.slice(0, 500),
        errors: errors.slice(0, 30),
        pageSuggestions,
        opportunities,
        sourceDates,
        pageCount,
        rowCount: rows.length,
        completedAt: input.completedAt.toISOString(),
    };
    return {
        rows,
        manifest,
        usableCompetitors: usableProfileIds.size,
        hasFailures: failedLegs > 0,
    };
}
