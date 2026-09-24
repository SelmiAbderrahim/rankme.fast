/**
 * SERP-features read surface.
 *
 * Reads ONLY stored `serp_observations` rows — no vendor call, no metric, no
 * preview. Ownership ("you hold this snippet / this PAA answer") is a
 * deterministic normalized-host match against the site's stored domain, the
 * same precedent `rankings.aiOverviewPresent` / `aiCited` set. No AI, no
 * fuzzy matching.
 *
 * HONESTY INVARIANT: the DTOs below can express only *observed* or
 * *not observed*. There is no `present: false` field anywhere, so no consumer
 * can render a claim about what Google does NOT show.
 */
import { and, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import type { Db } from '../../db/client.js';
import { keywords as keywordsTable } from '../../db/schema/keywords.js';
import type { SerpTopResult } from '../../db/schema/keywords.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { normalizeSerpDomain, type SerpFeatureType } from '../../shared/providers/index.js';
import { Site } from '../sites/index.js';
import { readHistoryForKeyword, readLatestForKeywords, type StoredObservation, } from './serp-observations.repo.js';
import { env } from '../../config/env.js';
export type SerpFeatureCaptureStatus = 'active' | 'paused';
function captureState(): {
    captureEnabled: boolean;
    captureStatus: SerpFeatureCaptureStatus;
} {
    const captureEnabled = env.SERP_FEATURE_TRACKING_ENABLED;
    return {
        captureEnabled,
        captureStatus: captureEnabled ? 'active' : 'paused',
    };
}
export interface SerpFeatureOwnership {
    /** Normalized host that holds the block. */
    domain: string;
    /** Matched URL, when the vendor exposed one. */
    url: string | null;
}
export interface SerpFeatureRowDto {
    keywordId: string;
    phrase: string;
    device: string;
    /** ISO 8601 of the check that produced this row; `null` = never observed. */
    observedAt: string | null;
    /** ONLY observed feature types. Empty = checked, nothing observed. */
    features: SerpFeatureType[];
    /** Present only when the SITE holds the featured snippet. */
    ownedSnippet: SerpFeatureOwnership | null;
    /** Every PAA question the SITE answers. Empty = none owned/observed. */
    ownedPaa: Array<{
        question: string;
        url: string | null;
    }>;
    /** Count of PAA questions observed on the check (owned or not). */
    paaCount: number;
    /** Rows stored in the latest observation's top-organic set. */
    topResultCount: number;
}
export interface SerpFeaturesListDto {
    siteId: string;
    /** Stored reads stay available while only NEW observation capture is paused. */
    captureEnabled: boolean;
    captureStatus: SerpFeatureCaptureStatus;
    rows: SerpFeatureRowDto[];
}
export interface SerpFeatureHistoryPointDto {
    observedAt: string;
    features: SerpFeatureType[];
    ownedSnippet: boolean;
    ownedPaaCount: number;
}
export interface SerpTopResultDto {
    rank: number;
    domain: string;
    url: string;
    /** True when the row's host is the site's own domain. */
    owned: boolean;
}
export interface SerpFeatureDetailDto {
    keywordId: string;
    phrase: string;
    /** Stored history remains readable independently of the capture kill switch. */
    captureEnabled: boolean;
    captureStatus: SerpFeatureCaptureStatus;
    /** `null` = no stored observation yet — the honest "not observed" state. */
    latest: {
        observedAt: string;
        features: SerpFeatureType[];
        ownedSnippet: SerpFeatureOwnership | null;
        snippetSource: SerpFeatureOwnership | null;
        paa: Array<{
            question: string;
            answerDomain: string | null;
            answerUrl: string | null;
            owned: boolean;
        }>;
        topResults: SerpTopResultDto[];
    } | null;
    history: SerpFeatureHistoryPointDto[];
}
export interface SerpFeaturesDeps {
    db: Db;
}
async function getOwnedSite(accountId: string, siteId: string): Promise<{
    domain: string;
}> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }, { domain: 1 }).lean();
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return { domain: site.domain };
}
function sameDomain(candidate: string | null, target: string): boolean {
    if (!candidate)
        return false;
    return normalizeSerpDomain(candidate) === target;
}
function featureTypes(observation: StoredObservation): SerpFeatureType[] {
    return observation.features.features.map((f) => f.type);
}
function snippetOwnership(observation: StoredObservation, target: string): SerpFeatureOwnership | null {
    const snippet = observation.features.featuredSnippet;
    if (!snippet || !sameDomain(snippet.domain, target))
        return null;
    return { domain: target, url: snippet.url };
}
/**
 * Who holds the featured snippet, regardless of ownership. `null` when the
 * check saw no snippet, or saw one the vendor did not attribute to a host —
 * both are "not observed", never a fabricated domain.
 */
function snippetSource(observation: StoredObservation): SerpFeatureOwnership | null {
    const snippet = observation.features.featuredSnippet;
    if (!snippet?.domain)
        return null;
    return { domain: snippet.domain, url: snippet.url };
}
function ownedPaa(observation: StoredObservation, target: string): Array<{
    question: string;
    url: string | null;
}> {
    return observation.features.paa
        .filter((entry) => sameDomain(entry.answerDomain, target))
        .map((entry) => ({ question: entry.question, url: entry.answerUrl }));
}
function toTopResultDto(rows: SerpTopResult[], target: string): SerpTopResultDto[] {
    return rows.map((row) => ({
        rank: row.rankGroup,
        domain: row.domain,
        url: row.url,
        owned: sameDomain(row.domain, target),
    }));
}
/**
 * Latest observation per active keyword for one owned site. A keyword with no
 * stored observation still appears, with `observedAt: null` — the surface must
 * be able to say "not observed yet" per keyword, never omit it silently.
 */
export async function listSerpFeatures(input: {
    accountId: string;
    siteId: string;
}, deps: SerpFeaturesDeps): Promise<SerpFeaturesListDto> {
    const site = await getOwnedSite(input.accountId, input.siteId);
    const target = normalizeSerpDomain(site.domain);
    const keywordRows = await deps.db
        .select({
        id: keywordsTable.id,
        phrase: keywordsTable.phrase,
        device: keywordsTable.device,
    })
        .from(keywordsTable)
        .where(and(eq(keywordsTable.siteId, input.siteId), eq(keywordsTable.accountId, input.accountId), eq(keywordsTable.active, true)))
        .orderBy(keywordsTable.phrase);
    const latest = await readLatestForKeywords(deps.db, input.siteId, keywordRows.map((row) => row.id));
    const rows: SerpFeatureRowDto[] = keywordRows.map((keyword) => {
        const observation = latest.get(keyword.id);
        if (!observation) {
            return {
                keywordId: keyword.id,
                phrase: keyword.phrase,
                device: keyword.device,
                observedAt: null,
                features: [],
                ownedSnippet: null,
                ownedPaa: [],
                paaCount: 0,
                topResultCount: 0,
            };
        }
        return {
            keywordId: keyword.id,
            phrase: keyword.phrase,
            device: keyword.device,
            observedAt: observation.checkedAt.toISOString(),
            features: featureTypes(observation),
            ownedSnippet: snippetOwnership(observation, target),
            ownedPaa: ownedPaa(observation, target),
            paaCount: observation.features.paa.length,
            topResultCount: observation.topResults.length,
        };
    });
    return { siteId: input.siteId, ...captureState(), rows };
}
/**
 * Per-keyword detail: the latest observation (features, PAA with ownership,
 * stored top-100) plus the stored history. Cross-account access is a 404, not
 * a 403 — the keyword row is scoped by `accountId` in the same query.
 */
export async function getSerpFeatureDetail(input: {
    accountId: string;
    keywordId: string;
}, deps: SerpFeaturesDeps): Promise<SerpFeatureDetailDto> {
    const rows = await deps.db
        .select({
        id: keywordsTable.id,
        phrase: keywordsTable.phrase,
        siteId: keywordsTable.siteId,
    })
        .from(keywordsTable)
        .where(and(eq(keywordsTable.id, input.keywordId), eq(keywordsTable.accountId, input.accountId)))
        .limit(1);
    const keyword = rows[0];
    if (!keyword)
        throw HttpError.notFound({ code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound' });
    const site = await getOwnedSite(input.accountId, keyword.siteId);
    const target = normalizeSerpDomain(site.domain);
    const history = await readHistoryForKeyword(deps.db, keyword.id);
    const newest = history[history.length - 1];
    return {
        keywordId: keyword.id,
        phrase: keyword.phrase,
        ...captureState(),
        latest: newest
            ? {
                observedAt: newest.checkedAt.toISOString(),
                features: featureTypes(newest),
                ownedSnippet: snippetOwnership(newest, target),
                // Reported ONLY when the vendor named the holding host. An unnamed
                // snippet stays `null` rather than degrading to an empty-string
                // domain the UI would render as "held by ''".
                snippetSource: snippetSource(newest),
                paa: newest.features.paa.map((entry) => ({
                    question: entry.question,
                    answerDomain: entry.answerDomain,
                    answerUrl: entry.answerUrl,
                    owned: sameDomain(entry.answerDomain, target),
                })),
                topResults: toTopResultDto(newest.topResults, target),
            }
            : null,
        history: history.map((observation) => ({
            observedAt: observation.checkedAt.toISOString(),
            features: featureTypes(observation),
            ownedSnippet: snippetOwnership(observation, target) !== null,
            ownedPaaCount: ownedPaa(observation, target).length,
        })),
    };
}
