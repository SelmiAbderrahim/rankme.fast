/**
 * Competitor content intelligence — deterministic deltas + opportunities.
 * Fully explainable, allocation-bounded, reproducible: same
 * inputs → same findings. NO AI is required for any finding here (the optional
 * `competitor_comparison` pass runs separately in the processor and never
 * changes these results).
 *
 * Evidence posture: every opportunity carries source-id evidence and
 * a confidence; a target-keyword opportunity requires DataForSEO demand
 * evidence (an intersecting query with search volume). Access failures are
 * NEVER called a weakness — they surface as `partialDomains` only. Comparison
 * is bounded to competitors with shared "like intent" query evidence where
 * available, so parity for its own sake is never recommended.
 *
 * SEC-INJECT: topic derivation uses a SINGLE FIXED split class, never a regex
 * built from crawled content, and every string is length-capped before use.
 */
import { COMPETITOR_CONTENT_SCHEMA_VERSION, COMPETITOR_CONTENT_THRESHOLDS_VERSION, type CompetitorContentConfidence, type CompetitorContentFindings, type CompetitorDelta, type CompetitorOpportunity, type CompetitorPageFacts, type LandscapeKeywordEvidence, } from './competitor-content.schemas.js';
// A single FIXED split class — never derived from crawled content (SEC-INJECT).
const TERM_SPLIT = /[^a-z0-9]+/;
/** Deterministic thresholds — versioned so a change is a reviewable diff. */
export interface CompetitorContentThresholds {
    version: string;
    /** A competitor page with this many more headings is a format gap. */
    headingGapMin: number;
    /** A competitor page with this many more internal links is a linking gap. */
    internalLinkGapMin: number;
    /** Min competitors covering a topic/schema for a HIGH-confidence gap. */
    highConfidenceCoverage: number;
    /** Max distinct topic terms retained per page (bounds comparison). */
    maxTermsPerPage: number;
    /** Max characters of any single string fed to tokenization. */
    maxTokenizedChars: number;
}
export const COMPETITOR_CONTENT_THRESHOLDS: CompetitorContentThresholds = {
    version: COMPETITOR_CONTENT_THRESHOLDS_VERSION,
    headingGapMin: 3,
    internalLinkGapMin: 5,
    highConfidenceCoverage: 2,
    maxTermsPerPage: 200,
    maxTokenizedChars: 4000,
};
export interface CompetitorDemandQuery {
    query: string;
    searchVolume: number | null;
}
export interface CompetitorPageInput {
    facts: CompetitorPageFacts;
    /** Shared "like intent" queries backing the comparison (intersections). */
    sharedQueries: string[];
    /** DataForSEO demand evidence for target-keyword opportunities. */
    demandQueries: CompetitorDemandQuery[];
    match?: {
        ownedUrl: string;
        landscapeReportId: string | null;
        landscapeOpportunityId: string | null;
        suggestionId: string | null;
        keywordEvidence: LandscapeKeywordEvidence[];
    };
}
function normalizeTerm(raw: string): string {
    return raw.slice(0, 120).trim().toLowerCase();
}
/** Topic term set from a page's title/headings/topics (bounded, fixed split). */
function topicTerms(facts: CompetitorPageFacts, thresholds: CompetitorContentThresholds): Set<string> {
    const terms = new Set<string>();
    const sources = [
        facts.title ?? '',
        ...facts.headings,
        ...facts.primaryTopics,
        ...facts.secondaryTopics,
    ];
    for (const source of sources) {
        const capped = source.slice(0, thresholds.maxTokenizedChars).toLowerCase();
        for (const raw of capped.split(TERM_SPLIT)) {
            if (raw.length < 4)
                continue;
            terms.add(raw);
            if (terms.size >= thresholds.maxTermsPerPage)
                return terms;
        }
    }
    return terms;
}
function schemaSet(facts: CompetitorPageFacts): Set<string> {
    return new Set(facts.schemaTypes.map(normalizeTerm).filter(Boolean));
}
function normalizeQuery(raw: string): string {
    return raw.slice(0, 400).trim().toLowerCase().split(TERM_SPLIT).filter(Boolean).join(' ');
}
function confidenceFromCoverage(count: number, thresholds: CompetitorContentThresholds): CompetitorContentConfidence {
    return count >= thresholds.highConfidenceCoverage ? 'high' : 'medium';
}
function mergeKeywordEvidence(deltas: readonly CompetitorDelta[], predicate: (delta: CompetitorDelta) => boolean): LandscapeKeywordEvidence[] {
    const seen = new Set<string>();
    const evidence: LandscapeKeywordEvidence[] = [];
    for (const delta of deltas) {
        if (!predicate(delta))
            continue;
        for (const item of delta.keywordEvidence) {
            const key = JSON.stringify([
                item.keyword,
                item.class,
                item.ownedPosition,
                item.competitorPosition,
                item.ownedUrl,
                item.competitorUrl,
                item.searchVolume,
                item.intent,
                item.provenanceIndexes,
            ]);
            if (seen.has(key))
                continue;
            seen.add(key);
            evidence.push(item);
            if (evidence.length >= 20)
                return evidence;
        }
    }
    return evidence;
}
/** Build one competitor delta (owned vs competitor). Pure + deterministic. */
export function buildDelta(owned: CompetitorPageFacts, competitor: CompetitorPageInput, thresholds: CompetitorContentThresholds = COMPETITOR_CONTENT_THRESHOLDS): CompetitorDelta {
    const ownedTerms = topicTerms(owned, thresholds);
    const compTerms = topicTerms(competitor.facts, thresholds);
    const ownedSchema = schemaSet(owned);
    const compSchema = schemaSet(competitor.facts);
    const domain = competitor.facts.competitorDomain ?? competitor.facts.url;
    const missingTopics = [...compTerms].filter((t) => !ownedTerms.has(t)).sort().slice(0, 40);
    const ownedOnlyTopics = [...ownedTerms].filter((t) => !compTerms.has(t)).sort().slice(0, 40);
    const missingSchemaTypes = [...compSchema].filter((t) => !ownedSchema.has(t)).sort().slice(0, 50);
    const sharedQueries = [...new Set(competitor.sharedQueries.map(normalizeQuery).filter(Boolean))]
        .sort()
        .slice(0, 50);
    return {
        competitorDomain: domain,
        competitorUrl: competitor.facts.url,
        ownedUrl: competitor.match?.ownedUrl ?? owned.url,
        landscapeReportId: competitor.match?.landscapeReportId ?? null,
        landscapeOpportunityId: competitor.match?.landscapeOpportunityId ?? null,
        suggestionId: competitor.match?.suggestionId ?? null,
        keywordEvidence: competitor.match?.keywordEvidence ?? [],
        wordCountDelta: competitor.facts.wordCount - owned.wordCount,
        headingCountDelta: competitor.facts.headings.length - owned.headings.length,
        internalLinkDelta: competitor.facts.internalLinkCount - owned.internalLinkCount,
        externalLinkDelta: competitor.facts.externalLinkCount - owned.externalLinkCount,
        missingSchemaTypes,
        missingTopics,
        ownedOnlyTopics,
        sharedQueries,
        snippetSourceId: `snippet:${domain}`,
    };
}
/**
 * Detect source-linked opportunities across all competitor deltas. Every
 * finding carries evidence source ids + a confidence. Deterministic + sorted.
 */
export function detectOpportunities(owned: CompetitorPageFacts, competitors: readonly CompetitorPageInput[], deltas: readonly CompetitorDelta[], keyword: string | null, thresholds: CompetitorContentThresholds = COMPETITOR_CONTENT_THRESHOLDS): CompetitorOpportunity[] {
    const opportunities: CompetitorOpportunity[] = [];
    // A stored keyword row is provenance, but only a query whose observed
    // owned/competitor ranking URLs equal the reviewed pair proves a like-page
    // comparison. Overrides keep their evidence visible while suppressing gap
    // claims until exact page evidence exists.
    const comparableDeltas = deltas.filter((delta) => delta.sharedQueries.length > 0);
    const comparableCompetitors = competitors.filter((_competitor, index) => deltas[index]?.sharedQueries.length);
    let seq = 0;
    const nextId = (kind: string): string => {
        const id = `opp-${kind}-${seq}`;
        seq += 1;
        return id;
    };
    // Topic gaps — a topic covered by competitors but not owned. Confidence rises
    // with the number of competitors covering it.
    const topicCoverage = new Map<string, Set<string>>();
    for (const delta of comparableDeltas) {
        for (const topic of delta.missingTopics) {
            const set = topicCoverage.get(topic) ?? new Set<string>();
            set.add(delta.competitorDomain);
            topicCoverage.set(topic, set);
        }
    }
    for (const [topic, domains] of [...topicCoverage].sort((a, b) => a[0].localeCompare(b[0]))) {
        opportunities.push({
            id: nextId('topic'),
            kind: 'topic_gap',
            messageKey: 'contentIntelligence.competitorContent.opportunityCopy.topicGap',
            messageVars: { topic },
            confidence: confidenceFromCoverage(domains.size, thresholds),
            evidenceSourceIds: [`topic:${topic}`, ...[...domains].sort().map((d) => `domain:${d}`)],
            keywordEvidence: mergeKeywordEvidence(comparableDeltas, (delta) => domains.has(delta.competitorDomain) && delta.missingTopics.includes(topic)),
        });
    }
    // Schema gaps — a structured-data type competitors declare that owned lacks.
    const schemaCoverage = new Map<string, Set<string>>();
    for (const delta of comparableDeltas) {
        for (const type of delta.missingSchemaTypes) {
            const set = schemaCoverage.get(type) ?? new Set<string>();
            set.add(delta.competitorDomain);
            schemaCoverage.set(type, set);
        }
    }
    for (const [type, domains] of [...schemaCoverage].sort((a, b) => a[0].localeCompare(b[0]))) {
        opportunities.push({
            id: nextId('schema'),
            kind: 'schema_gap',
            messageKey: 'contentIntelligence.competitorContent.opportunityCopy.schemaGap',
            messageVars: { schemaType: type },
            confidence: confidenceFromCoverage(domains.size, thresholds),
            evidenceSourceIds: [`schema:${type}`, ...[...domains].sort().map((d) => `domain:${d}`)],
            keywordEvidence: mergeKeywordEvidence(comparableDeltas, (delta) => domains.has(delta.competitorDomain) && delta.missingSchemaTypes.includes(type)),
        });
    }
    // Format gap — competitors substantially better structured (more headings).
    const richerHeadingDomains = comparableDeltas
        .filter((d) => d.headingCountDelta >= thresholds.headingGapMin)
        .map((d) => d.competitorDomain)
        .sort();
    if (richerHeadingDomains.length > 0) {
        opportunities.push({
            id: nextId('format'),
            kind: 'format_gap',
            messageKey: 'contentIntelligence.competitorContent.opportunityCopy.formatGap',
            confidence: confidenceFromCoverage(richerHeadingDomains.length, thresholds),
            evidenceSourceIds: richerHeadingDomains.map((d) => `domain:${d}`),
            keywordEvidence: mergeKeywordEvidence(comparableDeltas, (delta) => delta.headingCountDelta >= thresholds.headingGapMin),
        });
    }
    // Internal-linking gap — competitors link internally far more than owned.
    const richerLinkDomains = comparableDeltas
        .filter((d) => d.internalLinkDelta >= thresholds.internalLinkGapMin)
        .map((d) => d.competitorDomain)
        .sort();
    if (richerLinkDomains.length > 0) {
        opportunities.push({
            id: nextId('linking'),
            kind: 'internal_linking_gap',
            messageKey: 'contentIntelligence.competitorContent.opportunityCopy.internalLinkingGap',
            confidence: confidenceFromCoverage(richerLinkDomains.length, thresholds),
            evidenceSourceIds: richerLinkDomains.map((d) => `domain:${d}`),
            keywordEvidence: mergeKeywordEvidence(comparableDeltas, (delta) => delta.internalLinkDelta >= thresholds.internalLinkGapMin),
        });
    }
    // Differentiated strength — topics owned covers that NO competitor covers.
    const competitorTopicUnion = new Set<string>();
    for (const competitor of comparableCompetitors) {
        for (const term of topicTerms(competitor.facts, thresholds))
            competitorTopicUnion.add(term);
    }
    const ownedStrengths = comparableCompetitors.length === 0
        ? []
        : [...topicTerms(owned, thresholds)]
            .filter((t) => !competitorTopicUnion.has(t))
            .sort()
            .slice(0, 20);
    for (const strength of ownedStrengths) {
        opportunities.push({
            id: nextId('strength'),
            kind: 'differentiated_strength',
            messageKey: 'contentIntelligence.competitorContent.opportunityCopy.differentiatedStrength',
            messageVars: { topic: strength },
            confidence: 'medium',
            evidenceSourceIds: [`owned-topic:${strength}`],
            keywordEvidence: mergeKeywordEvidence(comparableDeltas, () => true),
        });
    }
    // Target keywords — DataForSEO demand (intersecting queries with volume).
    const demand = new Map<string, number | null>();
    for (const competitor of comparableCompetitors) {
        for (const dq of competitor.demandQueries) {
            const q = normalizeQuery(dq.query);
            if (!q)
                continue;
            const existing = demand.get(q);
            // Keep the highest observed search volume for the query.
            if (existing === undefined || (dq.searchVolume ?? 0) > (existing ?? 0)) {
                demand.set(q, dq.searchVolume);
            }
        }
    }
    const keywordNorm = keyword ? normalizeQuery(keyword) : null;
    for (const [query, volume] of [...demand].sort((a, b) => a[0].localeCompare(b[0]))) {
        // Relevance gate: either the run's focus keyword, or a query whose terms
        // overlap the owned page's topics — never demand with no site relevance.
        const relevant = (keywordNorm !== null && query.includes(keywordNorm)) ||
            query.split(' ').some((term) => topicTerms(owned, thresholds).has(term));
        if (!relevant)
            continue;
        opportunities.push({
            id: nextId('keyword'),
            kind: 'target_keyword',
            messageKey: 'contentIntelligence.competitorContent.opportunityCopy.targetKeyword',
            messageVars: { query },
            confidence: volume !== null && volume > 0 ? 'high' : 'medium',
            evidenceSourceIds: [`query:${query}`],
            keywordEvidence: mergeKeywordEvidence(comparableDeltas, (delta) => delta.keywordEvidence.some((item) => normalizeQuery(item.keyword) === query)),
        });
    }
    return opportunities;
}
export interface ReviewedCompetitorPairInput {
    owned: CompetitorPageFacts;
    competitor: CompetitorPageInput;
}
/** Compare each frozen owned/ranking-page leg only against its reviewed pair. */
export function compareReviewedPairs(pairs: readonly ReviewedCompetitorPairInput[], partialDomains: readonly string[], keyword: string | null, thresholds: CompetitorContentThresholds = COMPETITOR_CONTENT_THRESHOLDS): CompetitorContentFindings {
    const compared = pairs.map((pair) => compareCompetitors(pair.owned, [pair.competitor], [], keyword, thresholds));
    return {
        version: COMPETITOR_CONTENT_SCHEMA_VERSION,
        thresholdsVersion: thresholds.version,
        ownedUrl: pairs[0]?.owned.url ?? '',
        keyword,
        deltas: compared.flatMap((finding) => finding.deltas),
        opportunities: compared.flatMap((finding, pairIndex) => finding.opportunities.map((opportunity) => ({
            ...opportunity,
            id: `pair-${pairIndex}-${opportunity.id}`,
        }))),
        partialDomains: [...new Set(partialDomains)].sort(),
        aiExplanation: null,
    };
}
/**
 * Full deterministic comparison. Pure — the returned findings validate against
 * `competitorContentFindingsSchema`. `aiExplanation` starts null.
 */
export function compareCompetitors(owned: CompetitorPageFacts, competitors: readonly CompetitorPageInput[], partialDomains: readonly string[], keyword: string | null, thresholds: CompetitorContentThresholds = COMPETITOR_CONTENT_THRESHOLDS): CompetitorContentFindings {
    const deltas = competitors.map((c) => buildDelta(owned, c, thresholds));
    const opportunities = detectOpportunities(owned, competitors, deltas, keyword, thresholds);
    return {
        version: COMPETITOR_CONTENT_SCHEMA_VERSION,
        thresholdsVersion: thresholds.version,
        ownedUrl: owned.url,
        keyword: keyword ?? null,
        deltas,
        opportunities,
        partialDomains: [...partialDomains].sort(),
        aiExplanation: null,
    };
}
