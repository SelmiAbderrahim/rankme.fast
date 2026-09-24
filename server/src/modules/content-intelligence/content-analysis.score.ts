/**
 * Content Intelligence — deterministic scorecard + recommendations.
 *
 * Pure functions only: no I/O, no providers, no Date. The scorer compares
 * observed evidence (owned page vs. keyword/SERP/competitor evidence) and
 * NEVER invents values — missing evidence reduces the section confidence
 * instead of being replaced by a guess. Weights are declared in
 * `content-analysis.schemas.ts` (`SECTION_WEIGHTS`) and asserted to sum to
 * 100 at module load.
 *
 * SEC-INJECT: every scan over crawled text is length-capped BEFORE any
 * pattern work and uses linear scans (`includes`, whitespace tokenizing with
 * a static character-class split). No regex is ever built from crawled
 * content. Stuffing detection deliberately reports a suspicion without
 * recommending exact repetition counts.
 *
 * The score is a content-quality comparison signal — it is NOT presented as
 * a Google ranking factor (see the localized section copy).
 */
import { SECTION_WEIGHTS, SCORE_VERSION, SCORECARD_SECTIONS, type CompetitorEvidence, type KeywordEvidence, type OwnedPageFacts, type Recommendation, type Scorecard, type ScorecardSection, type ScorecardSectionKey, type SerpEvidence, } from './content-analysis.schemas.js';
const WEIGHT_TOTAL = SCORECARD_SECTIONS.reduce((sum, key) => sum + SECTION_WEIGHTS[key], 0);
if (WEIGHT_TOTAL !== 100) {
    throw new Error(`content-analysis SECTION_WEIGHTS must sum to 100 (got ${WEIGHT_TOTAL})`);
}
/** Length cap applied to every crawled-text scan (SEC-INJECT). */
export const SCAN_CHAR_CAP = 8000;
/** A term must occupy more than this share of tokens to look stuffed. */
const STUFFING_RATIO = 0.08;
/** ...and appear at least this many times (short pages can't trip it). */
const STUFFING_MIN_COUNT = 15;
/** Tokens shorter than this never count toward stuffing (stop-word proxy). */
const STUFFING_MIN_TOKEN_LENGTH = 4;
export interface ScoreInput {
    keyword: string;
    owned: OwnedPageFacts;
    keywordEvidence: KeywordEvidence | null;
    serp: SerpEvidence | null;
    competitors: readonly CompetitorEvidence[];
}
export interface ScoreOutput {
    scorecard: Scorecard;
    recommendations: Recommendation[];
    /** True when term-frequency analysis suggests keyword stuffing. */
    stuffingSuspected: boolean;
}
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const capped = (text: string | null | undefined): string => (text ?? '').slice(0, SCAN_CHAR_CAP).toLowerCase();
/** Linear containment scan over length-capped text. */
function containsTerm(haystack: string | null | undefined, term: string): boolean {
    const needle = term.slice(0, 400).toLowerCase().trim();
    if (needle.length === 0)
        return false;
    return capped(haystack).includes(needle);
}
function median(values: readonly number[]): number | null {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
/**
 * Term-frequency stuffing suspicion over the length-capped excerpt. Static
 * character-class split (linear), never a pattern from crawled input. Only
 * the tracked keyword's own terms count — a naturally frequent unrelated
 * word (a brand name) is not a stuffing signal.
 */
export function detectStuffing(excerpt: string, keyword: string): boolean {
    const text = capped(excerpt);
    if (text.length === 0)
        return false;
    const tokens = text
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= STUFFING_MIN_TOKEN_LENGTH);
    if (tokens.length < STUFFING_MIN_COUNT)
        return false;
    const counts = new Map<string, number>();
    for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const keywordTokens = new Set(keyword
        .slice(0, 400)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= STUFFING_MIN_TOKEN_LENGTH));
    for (const [token, count] of counts) {
        if (count < STUFFING_MIN_COUNT)
            continue;
        if (count / tokens.length <= STUFFING_RATIO)
            continue;
        if (keywordTokens.has(token))
            return true;
    }
    return false;
}
interface SectionResult {
    score: number;
    confidence: number;
    reason: string;
}
function reasonKey(section: ScorecardSectionKey, state: 'strong' | 'needsWork' | 'noEvidence'): string {
    return `contentIntelligence.reasons.${section}.${state}`;
}
function scoreIntent(input: ScoreInput): SectionResult {
    const { owned, keyword, serp, keywordEvidence } = input;
    if (!serp && !keywordEvidence) {
        return { score: 50, confidence: 0.2, reason: reasonKey('intent', 'noEvidence') };
    }
    let score = 0;
    if (containsTerm(owned.title, keyword))
        score += 40;
    if (containsTerm(owned.excerpt, keyword))
        score += 20;
    if (serp) {
        if (serp.ownedPosition !== null && serp.ownedPosition <= 10)
            score += 40;
        else if (serp.ownedPosition !== null && serp.ownedPosition <= 30)
            score += 25;
        else
            score += 10;
    }
    else {
        score += 10;
    }
    const confidence = serp && keywordEvidence ? 0.9 : 0.6;
    return {
        score: clamp(score, 0, 100),
        confidence,
        reason: reasonKey('intent', score >= 60 ? 'strong' : 'needsWork'),
    };
}
function scoreCoverage(input: ScoreInput, stuffing: boolean): SectionResult {
    const { owned, competitors } = input;
    const competitorWords = median(competitors.map((c) => c.wordCount).filter((n) => n > 0));
    const competitorHeadings = median(competitors.map((c) => c.headingCount).filter((n) => n > 0));
    let score: number;
    let confidence: number;
    if (competitorWords === null) {
        // No comparable competitor evidence — absolute-depth fallback, reduced
        // confidence (never invent a competitive baseline).
        score =
            owned.wordCount >= 1500 ? 85
                : owned.wordCount >= 800 ? 75
                    : owned.wordCount >= 300 ? 60
                        : Math.round((owned.wordCount / 300) * 60);
        confidence = 0.4;
    }
    else {
        const wordRatio = clamp(owned.wordCount / competitorWords, 0, 1.2) / 1.2;
        const headingRatio = competitorHeadings === null
            ? wordRatio
            : clamp(owned.headingCount / competitorHeadings, 0, 1.2) / 1.2;
        score = Math.round((wordRatio * 0.7 + headingRatio * 0.3) * 100);
        confidence = 0.9;
    }
    if (stuffing)
        score = Math.min(score, 40);
    return {
        score: clamp(score, 0, 100),
        confidence,
        reason: reasonKey('coverage', competitorWords === null ? 'noEvidence' : score >= 60 ? 'strong' : 'needsWork'),
    };
}
function scoreStructure(input: ScoreInput): SectionResult {
    const { owned } = input;
    let score = 0;
    if (owned.title) {
        score += owned.title.length >= 10 && owned.title.length <= 70 ? 40 : 25;
    }
    if (owned.description) {
        score += owned.description.length >= 50 && owned.description.length <= 170 ? 30 : 20;
    }
    if (owned.headingCount >= 2)
        score += 30;
    return {
        score: clamp(score, 0, 100),
        confidence: 1,
        reason: reasonKey('structure', score >= 60 ? 'strong' : 'needsWork'),
    };
}
function scoreLinks(input: ScoreInput): SectionResult {
    const { owned } = input;
    let score = 0;
    score += owned.internalLinkCount >= 3 ? 60 : owned.internalLinkCount * 20;
    if (owned.externalLinkCount >= 1)
        score += 40;
    return {
        score: clamp(score, 0, 100),
        confidence: 1,
        reason: reasonKey('links', score >= 60 ? 'strong' : 'needsWork'),
    };
}
function scoreSchema(input: ScoreInput): SectionResult {
    const { owned } = input;
    let score = 0;
    if (owned.schemaTypes.length > 0)
        score += 50;
    if (owned.hasSchemaOrgArticle)
        score += 30;
    if (owned.description)
        score += 20;
    return {
        score: clamp(score, 0, 100),
        confidence: 1,
        reason: reasonKey('schema', score >= 60 ? 'strong' : 'needsWork'),
    };
}
function scoreTechnical(input: ScoreInput): SectionResult {
    const { owned } = input;
    let score = 0;
    if (owned.language)
        score += 40;
    if (owned.canonical)
        score += 40;
    if (owned.excerpt.length > 0)
        score += 20;
    return {
        score: clamp(score, 0, 100),
        confidence: 1,
        reason: reasonKey('technical', score >= 60 ? 'strong' : 'needsWork'),
    };
}
interface RuleCheck {
    section: ScorecardSectionKey;
    ruleId: string;
    direction: Recommendation['direction'];
    triggered: (input: ScoreInput, stuffing: boolean) => boolean;
    /** True when the rule's evidence includes the competitor sources. */
    competitorEvidence?: boolean;
}
const RULES: readonly RuleCheck[] = [
    {
        section: 'intent', ruleId: 'keyword-in-title', direction: 'add',
        triggered: (i) => !containsTerm(i.owned.title, i.keyword),
    },
    {
        section: 'intent', ruleId: 'serp-presence', direction: 'strengthen',
        triggered: (i) => i.serp !== null && i.serp.ownedPosition === null,
    },
    {
        section: 'coverage', ruleId: 'expand-content', direction: 'add',
        competitorEvidence: true,
        triggered: (i) => {
            const med = median(i.competitors.map((c) => c.wordCount).filter((n) => n > 0));
            return med !== null && i.owned.wordCount < med * 0.6;
        },
    },
    {
        section: 'coverage', ruleId: 'broaden-headings', direction: 'add',
        competitorEvidence: true,
        triggered: (i) => {
            const med = median(i.competitors.map((c) => c.headingCount).filter((n) => n > 0));
            return med !== null && i.owned.headingCount < med;
        },
    },
    {
        section: 'coverage', ruleId: 'keyword-stuffing', direction: 'remove',
        triggered: (_i, stuffing) => stuffing,
    },
    {
        section: 'structure', ruleId: 'add-title', direction: 'add',
        triggered: (i) => !i.owned.title,
    },
    {
        section: 'structure', ruleId: 'add-description', direction: 'add',
        triggered: (i) => !i.owned.description,
    },
    {
        section: 'structure', ruleId: 'add-headings', direction: 'add',
        triggered: (i) => i.owned.headingCount < 2,
    },
    {
        section: 'links', ruleId: 'add-internal-links', direction: 'add',
        triggered: (i) => i.owned.internalLinkCount < 3,
    },
    {
        section: 'links', ruleId: 'add-external-links', direction: 'add',
        triggered: (i) => i.owned.externalLinkCount < 1,
    },
    {
        section: 'schema', ruleId: 'add-structured-data', direction: 'add',
        triggered: (i) => i.owned.schemaTypes.length === 0,
    },
    {
        section: 'schema', ruleId: 'mark-up-article', direction: 'clarify',
        triggered: (i) => i.owned.schemaTypes.length > 0 && !i.owned.hasSchemaOrgArticle,
    },
    {
        section: 'technical', ruleId: 'set-canonical', direction: 'add',
        triggered: (i) => !i.owned.canonical,
    },
    {
        section: 'technical', ruleId: 'set-language', direction: 'add',
        triggered: (i) => !i.owned.language,
    },
];
/**
 * Build the deterministic scorecard + recommendation records for one run.
 * Identical inputs always produce identical outputs (no clock, no random).
 */
export function buildScorecard(input: ScoreInput): ScoreOutput {
    const stuffing = detectStuffing(input.owned.excerpt, input.keyword);
    const sectionResults: Record<ScorecardSectionKey, SectionResult> = {
        intent: scoreIntent(input),
        coverage: scoreCoverage(input, stuffing),
        structure: scoreStructure(input),
        links: scoreLinks(input),
        schema: scoreSchema(input),
        technical: scoreTechnical(input),
    };
    const sections: ScorecardSection[] = SCORECARD_SECTIONS.map((key) => ({
        key,
        score: sectionResults[key].score,
        weight: SECTION_WEIGHTS[key],
        confidence: sectionResults[key].confidence,
        reason: sectionResults[key].reason,
    }));
    const total = clamp(Math.round(sections.reduce((sum, s) => sum + (s.score * s.weight) / 100, 0)), 0, 100);
    const competitorSourceIds = input.competitors.map((c) => c.sourceId).slice(0, 9);
    const recommendations: Recommendation[] = RULES.filter((rule) => rule.triggered(input, stuffing)).map((rule) => ({
        id: `rec-${rule.section}-${rule.ruleId}`,
        section: rule.section,
        ruleId: rule.ruleId,
        direction: rule.direction,
        confidence: sectionResults[rule.section].confidence,
        messageKey: `contentIntelligence.rules.${rule.ruleId}`,
        evidenceSourceIds: rule.competitorEvidence
            ? ['owned', ...competitorSourceIds]
            : ['owned'],
    }));
    return {
        scorecard: { version: SCORE_VERSION, total, sections },
        recommendations,
        stuffingSuspected: stuffing,
    };
}
