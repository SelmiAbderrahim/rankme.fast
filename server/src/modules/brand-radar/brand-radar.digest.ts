/**
 * Brand Radar — stage 3 `brand_digest` pass.
 *
 * ONE structured generation per scan, over the STORED, normalized mention rows
 * and the STORED mention summary — never a raw vendor envelope. The pass rides
 * inside the 150 000-micro Brand Radar run budget (20 000-micro
 * profile ceiling).
 *
 * Citation-or-drop:
 *
 *   A sentence survives ONLY if `citedRowIds` is non-empty AND every id in it
 *   is one of the scan's retained row ids. An uncited sentence is dropped; a
 *   sentence citing an id we never supplied is dropped whole rather than
 *   trimmed, because a fabricated citation makes the entire sentence
 *   untrustworthy — not just that one reference.
 *
 * A dropped sentence is never replaced. There is no "no data" filler sentence.
 *
 * Terminal digest states:
 *   `digest_present`     — at least one sentence survived enforcement.
 *   `no_reliable_digest` — the pass ran and every sentence was dropped.
 *   `digest_absent`      — the pass could not run or produce output at all
 *                          (budget refusal, vendor error, ceiling halt).
 *
 * Mention text and digest sentence text never reach a log line from this file.
 */
import { randomUUID } from 'node:crypto';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import type { ContentAnalysisMentionSummary } from '../../shared/providers/types.js';
import type { BrandRadarDigestState } from './brand-radar.model.js';
import type { StoredMentionRow } from './brand-radar.rows.model.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
export const BRAND_RADAR_DIGEST_PROFILE_NAME = 'brand_digest' as const;
/** Rows handed to one generation — matches the profile input bound. */
export const BRAND_RADAR_DIGEST_INPUT_MAX_ROWS = 60;
/** Bounds: ≤20 sentences, ≤300 characters each. */
export const BRAND_RADAR_DIGEST_MAX_SENTENCES = 20;
export const BRAND_RADAR_DIGEST_TEXT_MAX_CHARS = 300;
/** Cited ids per surviving sentence — matches the profile output bound. */
export const BRAND_RADAR_DIGEST_MAX_CITATIONS = 20;
export interface BrandRadarDigestSentence {
    text: string;
    citedRowIds: string[];
}
export interface BrandRadarDigestResult {
    digestSentences: BrandRadarDigestSentence[];
    digestState: BrandRadarDigestState;
    /** Actual-or-estimated AI cost; null when the pass never produced output. */
    costMicros: number | null;
}
export interface BrandRadarDigestDeps {
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
}
export interface RunBrandRadarDigestInput {
    accountId: string;
    /** Owning site — carried into AI cost attribution. */
    siteId: string;
    scanId: string;
    outputLocale: SupportedLocale;
    /** Stored, normalized rows — the ONLY mention material the model sees. */
    rows: readonly StoredMentionRow[];
    /** Stored vendor summary for the same scan; null when stage 2 stored none. */
    summary: ContentAnalysisMentionSummary | null;
}
interface GeneratedDigest {
    digestSentences: BrandRadarDigestSentence[];
    citations: string[];
}
function clamp(value: string, max: number): string {
    const glyphs = [...value];
    return glyphs.length > max ? glyphs.slice(0, max).join('') : value;
}
/**
 * Citation-or-drop enforcement. `retained` is the set of row ids this scan
 * actually stored; anything outside it was invented by the model.
 */
export function enforceDigestCitations(sentences: readonly BrandRadarDigestSentence[], retained: ReadonlySet<string>): BrandRadarDigestSentence[] {
    const kept: BrandRadarDigestSentence[] = [];
    for (const sentence of sentences) {
        if (sentence.citedRowIds.length === 0)
            continue;
        // One fabricated id poisons the sentence — drop it whole, never trim it
        // down to the ids that happened to be real.
        if (sentence.citedRowIds.some((id) => !retained.has(id)))
            continue;
        const cited: string[] = [];
        for (const id of sentence.citedRowIds) {
            if (!cited.includes(id))
                cited.push(id);
        }
        kept.push({
            text: clamp(sentence.text, BRAND_RADAR_DIGEST_TEXT_MAX_CHARS),
            citedRowIds: cited.slice(0, BRAND_RADAR_DIGEST_MAX_CITATIONS),
        });
        if (kept.length === BRAND_RADAR_DIGEST_MAX_SENTENCES)
            break;
    }
    return kept;
}
/** Bounded profile input built strictly from stored material. */
function buildDigestInput(input: RunBrandRadarDigestInput) {
    const rows = input.rows.slice(0, BRAND_RADAR_DIGEST_INPUT_MAX_ROWS);
    const summary = input.summary;
    return {
        mentions: rows.map((row) => ({
            id: row.id,
            domain: row.domain,
            title: row.title,
            snippet: row.snippet,
            polarity: row.polarity,
            observedAt: row.observedAt ? row.observedAt.toISOString() : null,
        })),
        summary: {
            // A missing stored summary is not an excuse to invent one: the counts
            // fall back to what the retained rows themselves prove.
            totalMentions: Math.max(0, Math.floor(summary?.totalMentions ?? input.rows.length)),
            positive: Math.max(0, Math.floor(summary?.distribution?.positive ?? 0)),
            neutral: Math.max(0, Math.floor(summary?.distribution?.neutral ?? 0)),
            negative: Math.max(0, Math.floor(summary?.distribution?.negative ?? 0)),
            topDomains: (summary?.topDomains ?? [])
                .slice(0, 50)
                .map((entry) => ({
                domain: entry.domain,
                mentions: Math.max(0, Math.floor(entry.mentions)),
            })),
        },
    };
}
/**
 * Run the digest pass for one scan.
 *
 * A scan with no retained rows never reaches the model — there is nothing to
 * cite, so the honest answer is `digest_absent` at zero AI cost.
 */
export async function runBrandRadarDigest(input: RunBrandRadarDigestInput, deps: BrandRadarDigestDeps): Promise<BrandRadarDigestResult> {
    if (input.rows.length === 0) {
        return { digestSentences: [], digestState: 'digest_absent', costMicros: null };
    }
    let generated;
    try {
        generated = await deps.ai.run<GeneratedDigest>({
            profile: BRAND_RADAR_DIGEST_PROFILE_NAME,
            input: buildDigestInput(input),
            locale: input.outputLocale,
            correlationId: `brand-digest-${randomUUID()}`,
            usage: {
                accountId: input.accountId,
                siteId: input.siteId,
                jobId: input.scanId,
            },
            configuredProviderOrder: deps.aiProviderOrder,
        });
    }
    catch {
        // Mentions already landed — the scan settles without a digest.
        return { digestSentences: [], digestState: 'digest_absent', costMicros: null };
    }
    const retained = new Set(input.rows.map((row) => row.id));
    const digestSentences = enforceDigestCitations(generated.object.digestSentences, retained);
    return {
        digestSentences,
        digestState: digestSentences.length > 0 ? 'digest_present' : 'no_reliable_digest',
        costMicros: Number(generated.provenance.actualOrEstimatedCostMicros),
    };
}
