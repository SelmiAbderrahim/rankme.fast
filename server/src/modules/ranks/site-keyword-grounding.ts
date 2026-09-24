import type { ContentDocument, SiteKeywordCandidate, } from '../../shared/providers/index.js';
export const SITE_KEYWORD_SEED_LIMIT = 20;
export const SITE_KEYWORD_SEED_MIN_WORDS = 2;
export const SITE_KEYWORD_SEED_MAX_WORDS = 8;
export const SITE_KEYWORD_SEED_MAX_CHARACTERS = 80;
/**
 * These words carry too little topical meaning to ground a suggestion. The
 * list is intentionally conservative: it removes navigation/auth/marketing
 * boilerplate that otherwise makes unrelated high-volume ideas look relevant.
 */
const GROUNDING_STOP_WORDS = new Set([
    'about',
    'account',
    'and',
    'app',
    'are',
    'asked',
    'best',
    'built',
    'choose',
    'create',
    'default',
    'for',
    'frequently',
    'free',
    'from',
    'get',
    'how',
    'into',
    'login',
    'legal',
    'make',
    'new',
    'one',
    'online',
    'our',
    'plan',
    'pricing',
    'private',
    'product',
    'purchase',
    'purchases',
    'question',
    'questions',
    'sign',
    'site',
    'that',
    'the',
    'this',
    'time',
    'tool',
    'use',
    'website',
    'what',
    'with',
    'works',
    'you',
    'your',
]);
const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const PHRASE_SEPARATOR_PATTERN = /(?:[,;|•·.!?…:(){}]|\[|\])+/gu;
export interface SiteKeywordEvidence {
    seeds: string[];
    metadataTokens: string[];
    descriptiveTokens: string[];
}
interface ScoredCandidate {
    candidate: SiteKeywordCandidate;
    score: number;
    searchVolume: number;
}
function normalizeText(value: string): string {
    return value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/gu, ' ')
        .trim();
}
function tokenize(value: string): string[] {
    return normalizeText(value).match(TOKEN_PATTERN) ?? [];
}
function topicalTokens(value: string): string[] {
    return tokenize(value).filter((token) => token.length >= 3 && !GROUNDING_STOP_WORDS.has(token));
}
function phrasesFrom(value: string): string[] {
    const phrases: string[] = [];
    for (const segment of normalizeText(value).split(PHRASE_SEPARATOR_PATTERN)) {
        const tokens = segment.match(TOKEN_PATTERN) ?? [];
        if (tokens.length < SITE_KEYWORD_SEED_MIN_WORDS)
            continue;
        for (let start = 0; start < tokens.length; start += SITE_KEYWORD_SEED_MAX_WORDS) {
            const chunk = tokens.slice(start, start + SITE_KEYWORD_SEED_MAX_WORDS);
            if (chunk.length < SITE_KEYWORD_SEED_MIN_WORDS)
                continue;
            const phrase = chunk.join(' ');
            if (phrase.length <= SITE_KEYWORD_SEED_MAX_CHARACTERS
                && topicalTokens(phrase).length >= SITE_KEYWORD_SEED_MIN_WORDS)
                phrases.push(phrase);
        }
    }
    return phrases;
}
function pushUnique(target: string[], seen: Set<string>, values: readonly string[]): void {
    for (const value of values) {
        if (seen.has(value))
            continue;
        seen.add(value);
        target.push(value);
    }
}
/**
 * Extract deterministic seeds from page metadata and H1/H2 evidence only.
 * Arbitrary body, navigation, links, and form copy never enter the seed set.
 */
export function extractSiteKeywordEvidence(documents: readonly ContentDocument[]): SiteKeywordEvidence {
    const metadataPhrases: string[] = [];
    const descriptivePhrases: string[] = [];
    const metadataTokens: string[] = [];
    const descriptiveTokens: string[] = [];
    const metadataPhraseSeen = new Set<string>();
    const descriptivePhraseSeen = new Set<string>();
    const metadataTokenSeen = new Set<string>();
    const descriptiveTokenSeen = new Set<string>();
    for (const document of documents) {
        for (const keyword of document.metadataKeywords ?? []) {
            pushUnique(metadataPhrases, metadataPhraseSeen, phrasesFrom(keyword));
            pushUnique(metadataTokens, metadataTokenSeen, topicalTokens(keyword));
        }
        const descriptions = [
            document.title,
            document.description,
            ...document.headings
                .filter((heading) => heading.level <= 2)
                .map((heading) => heading.text),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        for (const description of descriptions) {
            pushUnique(descriptivePhrases, descriptivePhraseSeen, phrasesFrom(description));
            pushUnique(descriptiveTokens, descriptiveTokenSeen, topicalTokens(description));
        }
    }
    const seeds: string[] = [];
    const seedSeen = new Set<string>();
    pushUnique(seeds, seedSeen, metadataPhrases);
    if (seeds.length < SITE_KEYWORD_SEED_LIMIT) {
        pushUnique(seeds, seedSeen, descriptivePhrases);
    }
    return {
        seeds: seeds.slice(0, SITE_KEYWORD_SEED_LIMIT),
        metadataTokens,
        descriptiveTokens,
    };
}
function tokensMatch(candidate: string, evidence: string): boolean {
    if (candidate === evidence)
        return true;
    if (candidate.length < 5 || evidence.length < 5)
        return false;
    return candidate.slice(0, 5) === evidence.slice(0, 5);
}
function matchCount(candidateTokens: readonly string[], evidenceTokens: readonly string[]): number {
    let count = 0;
    const matched = new Set<string>();
    for (const candidateToken of candidateTokens) {
        if (matched.has(candidateToken))
            continue;
        if (evidenceTokens.some((evidenceToken) => tokensMatch(candidateToken, evidenceToken))) {
            matched.add(candidateToken);
            count += 1;
        }
    }
    return count;
}
/**
 * Keep only ideas tied to the crawled site: one metadata token or two distinct
 * descriptive tokens. This intentionally fails closed when evidence is thin.
 */
export function groundSiteKeywordCandidates(candidates: readonly SiteKeywordCandidate[], evidence: SiteKeywordEvidence, limit: number): SiteKeywordCandidate[] {
    if (limit <= 0)
        return [];
    const scored: ScoredCandidate[] = [];
    for (const rawCandidate of candidates) {
        const keyword = normalizeText(rawCandidate.keyword);
        if (keyword.length === 0
            || keyword.length > SITE_KEYWORD_SEED_MAX_CHARACTERS
            || rawCandidate.searchVolume === null
            || rawCandidate.searchVolume <= 0)
            continue;
        const candidateTokens = topicalTokens(keyword);
        const metadataMatches = matchCount(candidateTokens, evidence.metadataTokens);
        const descriptiveMatches = matchCount(candidateTokens, evidence.descriptiveTokens);
        if (metadataMatches < 1 && descriptiveMatches < 2)
            continue;
        scored.push({
            candidate: { ...rawCandidate, keyword },
            score: metadataMatches * 100 + descriptiveMatches * 10,
            searchVolume: rawCandidate.searchVolume,
        });
    }
    scored.sort((left, right) => right.score - left.score
        || right.searchVolume - left.searchVolume
        || left.candidate.keyword.localeCompare(right.candidate.keyword));
    const grounded: SiteKeywordCandidate[] = [];
    const seen = new Set<string>();
    for (const row of scored) {
        if (seen.has(row.candidate.keyword))
            continue;
        seen.add(row.candidate.keyword);
        grounded.push(row.candidate);
        if (grounded.length >= limit)
            break;
    }
    return grounded;
}
