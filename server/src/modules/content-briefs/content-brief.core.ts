import type { ContentDocument, StructuredDataFact } from '../../shared/providers/content-source.js';
export interface StoredBriefDocument {
    id: string;
    sourceUrl: string;
    title: string;
    excerpt: string;
    headings: Array<{
        level: number;
        text: string;
    }>;
    capturedAt: Date;
    wordCount: number;
    entityLabels: string[];
}
export interface ContentBriefCorpusStats {
    wordCount: {
        min: number | null;
        max: number | null;
        average: number | null;
        documentCount: number;
    };
    headingHistogram: {
        h1: number;
        h2: number;
        h3: number;
        h4: number;
        h5: number;
        h6: number;
    };
    entities: Array<{
        label: string;
        documentCount: number;
    }>;
    scrapeDates: Date[];
}
export interface DraftComparison {
    wordCount: number;
    corpusMin: number | null;
    corpusMax: number | null;
    corpusAverage: number | null;
    wordDeltaFromAverage: number | null;
    headingCount: number;
    corpusAverageHeadings: number | null;
    matchedEntities: number;
    totalEntities: number;
    deterministicScore: number;
}
const ENTITY_PROPERTIES = new Set(['@type', 'type', 'name', 'headline', 'about', 'mentions']);
const WORD_RE = /[\p{L}\p{N}]+/gu;
const CONTROL_CHARACTERS_RE = new RegExp(String.raw `[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`, 'gu');
export function boundedPlainText(value: string | null | undefined, max: number): string {
    return (value ?? '')
        .replace(CONTROL_CHARACTERS_RE, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, max);
}
export function countWords(value: string): number {
    return value.match(WORD_RE)?.length ?? 0;
}
function factLabels(fact: StructuredDataFact): string[] {
    const labels = [boundedPlainText(fact.type, 120)];
    if (ENTITY_PROPERTIES.has(fact.property) && typeof fact.value === 'string') {
        labels.push(boundedPlainText(fact.value, 120));
    }
    return labels.filter(Boolean);
}
export function entityLabelsForDocument(facts: readonly StructuredDataFact[]): string[] {
    const byCanonical = new Map<string, string>();
    for (const fact of facts) {
        for (const label of factLabels(fact)) {
            const canonical = label.toLocaleLowerCase('en');
            if (!byCanonical.has(canonical))
                byCanonical.set(canonical, label);
        }
    }
    return [...byCanonical.values()].sort((a, b) => a.localeCompare(b)).slice(0, 50);
}
export function toStoredBriefDocument(document: ContentDocument, index: number): StoredBriefDocument {
    const sourceText = document.text.length > 0 ? document.text : document.markdown;
    const excerpt = boundedPlainText(sourceText, 4000);
    return {
        id: `doc-${index + 1}`,
        sourceUrl: document.sourceUrl.slice(0, 2048),
        title: boundedPlainText(document.title, 300),
        excerpt,
        headings: document.headings.slice(0, 100).map((heading) => ({
            level: Math.min(6, Math.max(1, heading.level)),
            text: boundedPlainText(heading.text, 300),
        })),
        capturedAt: document.capturedAt,
        wordCount: countWords(boundedPlainText(sourceText, 100000)),
        entityLabels: entityLabelsForDocument(document.structuredData),
    };
}
export function computeCorpusStats(documents: readonly StoredBriefDocument[]): ContentBriefCorpusStats {
    const wordCounts = documents.map((document) => document.wordCount);
    const histogram = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    const entityDocuments = new Map<string, {
        label: string;
        documents: Set<string>;
    }>();
    for (const document of documents) {
        for (const heading of document.headings) {
            const key = `h${heading.level}` as keyof typeof histogram;
            histogram[key] += 1;
        }
        for (const label of document.entityLabels) {
            const canonical = label.toLocaleLowerCase('en');
            const entry = entityDocuments.get(canonical) ?? { label, documents: new Set<string>() };
            entry.documents.add(document.id);
            entityDocuments.set(canonical, entry);
        }
    }
    const entities = [...entityDocuments.values()]
        .map((entry) => ({ label: entry.label, documentCount: entry.documents.size }))
        .sort((a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label))
        .slice(0, 50);
    return {
        wordCount: {
            min: wordCounts.length > 0 ? Math.min(...wordCounts) : null,
            max: wordCounts.length > 0 ? Math.max(...wordCounts) : null,
            average: wordCounts.length > 0
                ? Math.round(wordCounts.reduce((sum, value) => sum + value, 0) / wordCounts.length)
                : null,
            documentCount: wordCounts.length,
        },
        headingHistogram: histogram,
        entities,
        scrapeDates: documents.map((document) => document.capturedAt),
    };
}
function countDraftHeadings(draft: string): number {
    return draft
        .split(/\r?\n/u)
        .filter((line) => /^#{1,6}\s+\S/u.test(line.trim())).length;
}
function rangeScore(wordCount: number, min: number | null, max: number | null): number {
    if (min === null || max === null)
        return 0;
    if (wordCount >= min && wordCount <= max)
        return 40;
    const nearest = wordCount < min ? min : max;
    // A zero word count inside a [0, 0] corpus returned above. Reaching this
    // branch therefore means a non-empty draft against a zero-word corpus.
    if (nearest === 0)
        return 0;
    return Math.max(0, Math.round(40 * (1 - Math.abs(wordCount - nearest) / nearest)));
}
export function compareDraftToCorpus(draft: string, stats: ContentBriefCorpusStats): DraftComparison {
    const normalizedDraft = boundedPlainText(draft, 50000);
    const wordCount = countWords(normalizedDraft);
    const headingCount = countDraftHeadings(draft);
    const corpusHeadingTotal = Object.values(stats.headingHistogram).reduce((sum, value) => sum + value, 0);
    const corpusAverageHeadings = stats.wordCount.documentCount > 0
        ? Math.round(corpusHeadingTotal / stats.wordCount.documentCount)
        : null;
    const headingScore = corpusAverageHeadings === null
        ? 0
        : corpusAverageHeadings === 0
            ? headingCount === 0
                ? 30
                : 0
            : Math.max(0, Math.round(30 * (1 - Math.abs(headingCount - corpusAverageHeadings) / corpusAverageHeadings)));
    const foldedDraft = normalizedDraft.toLocaleLowerCase('en');
    const matchedEntities = stats.entities.filter((entity) => foldedDraft.includes(entity.label.toLocaleLowerCase('en'))).length;
    const entityScore = stats.entities.length === 0 ? 0 : Math.round((matchedEntities / stats.entities.length) * 30);
    const deterministicScore = Math.min(100, rangeScore(wordCount, stats.wordCount.min, stats.wordCount.max) + headingScore + entityScore);
    return {
        wordCount,
        corpusMin: stats.wordCount.min,
        corpusMax: stats.wordCount.max,
        corpusAverage: stats.wordCount.average,
        wordDeltaFromAverage: stats.wordCount.average === null ? null : wordCount - stats.wordCount.average,
        headingCount,
        corpusAverageHeadings,
        matchedEntities,
        totalEntities: stats.entities.length,
        deterministicScore,
    };
}
export interface BriefScoringEvidence {
    mode: 'brief' | 'rescore';
    keyword: string;
    documents: Array<{
        id: string;
        title: string;
        excerpt: string;
        headings: string[];
        capturedAt: string;
    }>;
    corpusRows: Array<{
        id: string;
        label: string;
        value: string;
    }>;
    paaRows: Array<{
        id: string;
        question: string;
        answerDomain: string | null;
        answerUrl: string | null;
    }>;
    secondaryTerms: Array<{
        id: string;
        term: string;
    }>;
    draft?: string;
}
export function buildBriefScoringEvidence(input: {
    mode: 'brief' | 'rescore';
    keyword: string;
    documents: readonly StoredBriefDocument[];
    stats: ContentBriefCorpusStats;
    paaRows: readonly {
        id: string;
        question: string;
        answerDomain: string | null;
        answerUrl: string | null;
    }[];
    secondaryTerms: readonly {
        id: string;
        term: string;
    }[];
    draft?: string;
}): BriefScoringEvidence {
    const corpusRows = [
        { id: 'stat-word-min', label: 'word_count_min', value: String(input.stats.wordCount.min ?? '') },
        { id: 'stat-word-max', label: 'word_count_max', value: String(input.stats.wordCount.max ?? '') },
        {
            id: 'stat-word-average',
            label: 'word_count_average',
            value: String(input.stats.wordCount.average ?? ''),
        },
        ...Object.entries(input.stats.headingHistogram).map(([level, value]) => ({
            id: `stat-heading-${level}`,
            label: `heading_${level}`,
            value: String(value),
        })),
    ];
    return {
        mode: input.mode,
        keyword: input.keyword,
        documents: input.documents.map((document) => ({
            id: document.id,
            title: document.title,
            excerpt: document.excerpt,
            headings: document.headings.map((heading) => `${heading.level}:${heading.text}`),
            capturedAt: document.capturedAt.toISOString(),
        })),
        corpusRows,
        paaRows: input.paaRows.map((row) => ({ ...row })),
        secondaryTerms: input.secondaryTerms.map((term) => ({ ...term })),
        ...(input.draft === undefined ? {} : { draft: input.draft }),
    };
}
export interface BriefScoringOutput {
    outline: Array<{
        id: string;
        heading: string;
        purpose: string;
        citations: string[];
    }>;
    questions: Array<{
        question: string;
        citations: string[];
    }>;
    score: number | null;
    rationale: string | null;
    citations: string[];
}
function uniqueKnownCitations(values: readonly string[], allowed: ReadonlySet<string>): string[] {
    return [...new Set(values.filter((value) => allowed.has(value)))].slice(0, 5);
}
export function filterBriefScoringOutput(output: BriefScoringOutput, evidence: BriefScoringEvidence): {
    output: BriefScoringOutput;
    rejected: boolean;
} {
    const allowed = new Set([
        ...evidence.documents.map((row) => row.id),
        ...evidence.corpusRows.map((row) => row.id),
        ...evidence.paaRows.map((row) => row.id),
        ...evidence.secondaryTerms.map((row) => row.id),
    ]);
    const seenOutlineIds = new Set<string>();
    let rejected = false;
    const outline = output.outline.flatMap((node) => {
        const citations = uniqueKnownCitations(node.citations, allowed);
        const supportsOutline = citations.some((citation) => citation.startsWith('doc-') ||
            citation.startsWith('stat-') ||
            citation.startsWith('term-'));
        if (evidence.mode !== 'brief' ||
            citations.length === 0 ||
            !supportsOutline ||
            seenOutlineIds.has(node.id)) {
            rejected = true;
            return [];
        }
        seenOutlineIds.add(node.id);
        if (citations.length !== node.citations.length)
            rejected = true;
        return [{ ...node, citations }];
    });
    const questions = output.questions.flatMap((question) => {
        const citations = uniqueKnownCitations(question.citations, allowed);
        const hasPaa = citations.some((citation) => citation.startsWith('paa-'));
        if (evidence.mode !== 'brief' || citations.length === 0 || !hasPaa) {
            rejected = true;
            return [];
        }
        if (citations.length !== question.citations.length)
            rejected = true;
        return [{ ...question, citations }];
    });
    const topCitations = uniqueKnownCitations(output.citations, allowed);
    if (topCitations.length !== output.citations.length)
        rejected = true;
    const rescoreGrounded = evidence.mode !== 'rescore' || topCitations.length > 0;
    if (!rescoreGrounded)
        rejected = true;
    return {
        output: {
            outline,
            questions,
            score: evidence.mode === 'rescore' && rescoreGrounded ? output.score : null,
            rationale: evidence.mode === 'rescore' && rescoreGrounded ? output.rationale : null,
            citations: topCitations,
        },
        rejected,
    };
}
