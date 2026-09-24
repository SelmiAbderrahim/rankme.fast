/**
 * Deterministic query templates.
 *
 * Version 1 is locked. AI never generates queries. The output list is bounded
 * (≤ QUERY_CAP) and stable: identical (input, existingKeywords, ownDomain)
 * always produces the same ordered list.
 */
export const QUERY_TEMPLATE_VERSION = 1 as const;
export const QUERY_CAP = 40 as const;
export const PER_QUERY_LIMIT = 10 as const;
export const TRACKED_KEYWORD_CAP = 5 as const;
export type QueryCategory = 'complaint' | 'request' | 'question' | 'review' | 'comparison' | 'alternative';
export type QueryTemplateId = 'v1.complaint.problems_site' | 'v1.complaint.reviews' | 'v1.request.feature_request' | 'v1.question.how_to' | 'v1.question.why_does' | 'v1.review.best' | 'v1.comparison.competitor_vs_own' | 'v1.alternative.competitor_alt';
export interface GeneratedQuery {
    id: string;
    text: string;
    templateId: QueryTemplateId;
    category: QueryCategory;
}
export interface QueryGenerationInput {
    seedTopics: readonly string[];
    competitorDomains: readonly string[];
    existingKeywords?: readonly string[];
    ownDomain?: string | null;
}
function normalize(v: string): string {
    return v.trim().toLowerCase();
}
function dedupeSorted(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        const n = normalize(v);
        if (n.length === 0)
            continue;
        if (seen.has(n))
            continue;
        seen.add(n);
        out.push(n);
    }
    return out.sort();
}
/**
 * Deterministic order (locked). Every emitted row goes through the SAME
 * append-then-cap check, so the "cap hit → stop" branch is exercised by any
 * input that produces > QUERY_CAP rows.
 */
export function generateQueries(input: QueryGenerationInput): GeneratedQuery[] {
    const seeds = dedupeSorted(input.seedTopics);
    const competitors = dedupeSorted(input.competitorDomains);
    const extra = dedupeSorted(input.existingKeywords ?? []).slice(0, TRACKED_KEYWORD_CAP);
    const ownDomain = input.ownDomain ? normalize(input.ownDomain) : '';
    const topics = seeds.length > 0 ? seeds : extra;
    const dedupedTopics = dedupeSorted(topics);
    const emissions: Array<{
        category: QueryCategory;
        templateId: QueryTemplateId;
        text: string;
    }> = [];
    for (const topic of dedupedTopics) {
        for (const competitor of competitors) {
            emissions.push({
                category: 'complaint',
                templateId: 'v1.complaint.problems_site',
                text: `"${topic}" problems site:${competitor}`,
            });
        }
    }
    for (const topic of dedupedTopics) {
        emissions.push({
            category: 'complaint',
            templateId: 'v1.complaint.reviews',
            text: `"${topic}" reviews`,
        });
        emissions.push({
            category: 'request',
            templateId: 'v1.request.feature_request',
            text: `"${topic}" feature request`,
        });
        emissions.push({
            category: 'question',
            templateId: 'v1.question.how_to',
            text: `how to ${topic}`,
        });
        emissions.push({
            category: 'question',
            templateId: 'v1.question.why_does',
            text: `why does ${topic}`,
        });
        emissions.push({
            category: 'review',
            templateId: 'v1.review.best',
            text: `best ${topic}`,
        });
    }
    if (ownDomain.length > 0) {
        for (const competitor of competitors) {
            emissions.push({
                category: 'comparison',
                templateId: 'v1.comparison.competitor_vs_own',
                text: `${competitor} vs ${ownDomain}`,
            });
        }
    }
    for (const competitor of competitors) {
        emissions.push({
            category: 'alternative',
            templateId: 'v1.alternative.competitor_alt',
            text: `${competitor} alternative`,
        });
    }
    const capped = emissions.slice(0, QUERY_CAP);
    return capped.map((e, i) => ({
        id: `q-${String(i + 1).padStart(3, '0')}`,
        text: e.text,
        templateId: e.templateId,
        category: e.category,
    }));
}
