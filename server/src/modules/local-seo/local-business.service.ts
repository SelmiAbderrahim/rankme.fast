/**
  * Local SEO business setup.
  *
  * The owner searches for their business by name, address or Google place ID,
  * picks one of the returned candidates and saves it for the site. Refresh
  * then describes exactly that business (see `refreshLocalListings`).
  *
  * Spend: one search is one vendor lookup (at most $0.021, see the adapter
  * header), guarded by a short per-site cooldown. Saving, changing or clearing
  * a selection never calls the vendor.
  */
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { Cooldown } from '../../shared/cooldown/index.js';
import type {
    LocalBusinessCandidate,
    LocalListingsProvider,
} from '../../shared/providers/index.js';
import { ProviderError, captureVendorCost } from '../../shared/providers/index.js';
import { createVendorArchiver, createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertGeogridEnabled } from '../geogrid/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import {
    BUSINESS_CANDIDATE_MAX,
    BUSINESS_CANDIDATE_TTL_MS,
    BUSINESS_ID_MAX_CHARS,
    BUSINESS_TEXT_MAX_CHARS,
    LocalBusinessProfile,
    orNull,
} from './local-business.model.js';
import { loadOwnedSite } from './local-seo.service.js';

export interface LocalBusinessDeps {
    db: Db;
    provider: LocalListingsProvider;
    cooldown?: Cooldown;
    now?: () => Date;
}

/** Short per-site window so a double submit never repeats the vendor lookup. */
export const LOCAL_BUSINESS_SEARCH_COOLDOWN_MS = 5_000;

export interface LocalBusinessCandidateView {
    candidateId: string;
    placeId: string | null;
    cid: string | null;
    name: string;
    address: string | null;
    phone: string | null;
    domain: string | null;
    category: string | null;
    latitude: number | null;
    longitude: number | null;
}

export interface SelectedLocalBusinessView extends Omit<LocalBusinessCandidateView, 'candidateId'> {
    locationCode: number;
    languageCode: string;
    selectedAt: string;
}

export interface LocalBusinessSetupView {
    selected: SelectedLocalBusinessView | null;
    candidates: LocalBusinessCandidateView[];
    query: string | null;
    candidatesExpireAt: string | null;
}

type StoredBusiness = {
    placeId?: string | null;
    cid?: string | null;
    name: string;
    address?: string | null;
    phone?: string | null;
    domain?: string | null;
    category?: string | null;
    latitude?: number | null;
    longitude?: number | null;
};

function clip(value: string | null, max: number): string | null {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : [...trimmed].slice(0, max).join('');
}

/** Coordinates are kept only as a valid pair; anything else is dropped. */
function coordinates(candidate: LocalBusinessCandidate): { latitude: number | null; longitude: number | null } {
    const { latitude, longitude } = candidate;
    const valid =
        latitude !== null &&
        longitude !== null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
    return valid ? { latitude, longitude } : { latitude: null, longitude: null };
}

/** Bounded, storable candidate; a row whose identifiers do not fit is unusable. */
function toStoredCandidate(candidate: LocalBusinessCandidate) {
    const placeId = clip(candidate.placeId, BUSINESS_ID_MAX_CHARS + 1);
    const cid = clip(candidate.cid, BUSINESS_ID_MAX_CHARS + 1);
    const fits = (id: string | null) => id === null || id.length <= BUSINESS_ID_MAX_CHARS;
    const name = clip(candidate.name, BUSINESS_TEXT_MAX_CHARS);
    if (!name || (!placeId && !cid) || !fits(placeId) || !fits(cid)) return null;
    return {
        candidateId: randomUUID(),
        placeId,
        cid,
        name,
        address: clip(candidate.address, BUSINESS_TEXT_MAX_CHARS),
        phone: clip(candidate.phone, BUSINESS_TEXT_MAX_CHARS),
        domain: clip(candidate.domain, BUSINESS_TEXT_MAX_CHARS),
        category: clip(candidate.category, BUSINESS_TEXT_MAX_CHARS),
        ...coordinates(candidate),
    };
}

function businessView(stored: StoredBusiness): Omit<LocalBusinessCandidateView, 'candidateId'> {
    return {
        placeId: orNull(stored.placeId),
        cid: orNull(stored.cid),
        name: stored.name,
        address: orNull(stored.address),
        phone: orNull(stored.phone),
        domain: orNull(stored.domain),
        category: orNull(stored.category),
        latitude: orNull(stored.latitude),
        longitude: orNull(stored.longitude),
    };
}

type ProfileDoc = NonNullable<Awaited<ReturnType<typeof findProfile>>>;

function findProfile(accountId: string, siteId: string) {
    return LocalBusinessProfile.findOne({ accountId, siteId }).lean();
}

function setupView(profile: ProfileDoc | null, now: Date): LocalBusinessSetupView {
    const selected = profile?.selected ?? null;
    const fresh = Boolean(profile?.candidatesExpireAt && profile.candidatesExpireAt > now);
    return {
        selected: selected
            ? {
                    ...businessView(selected),
                    locationCode: selected.locationCode,
                    languageCode: selected.languageCode,
                    selectedAt: selected.selectedAt.toISOString(),
                }
            : null,
        candidates: fresh
            ? profile!.candidates.map((c) => ({ candidateId: c.candidateId, ...businessView(c) }))
            : [],
        query: fresh ? orNull(profile!.candidatesQuery) : null,
        candidatesExpireAt: fresh ? profile!.candidatesExpireAt!.toISOString() : null,
    };
}

export async function readLocalBusinessSetup(
    input: { accountId: string; siteId: string },
    deps: { now?: () => Date },
): Promise<LocalBusinessSetupView> {
    const site = await loadOwnedSite(input);
    const profile = await findProfile(input.accountId, site.id);
    return setupView(profile, (deps.now ?? (() => new Date()))());
}

/**
  * The vendor lookup shared by business setup and the geogrid centre search:
  * paused guard, double-submit cooldown, the provider call and its archive row. Returns bounded candidates.
  */
async function runBusinessSearch(
    input: { accountId: string; siteId: string; query: string },
    deps: LocalBusinessDeps,
    purpose: 'business-search' | 'place-search',
) {
    const now = (deps.now ?? (() => new Date()))();
    const site = await loadOwnedSite(input);
    assertSiteNotPaused(site);
    // The centre search only feeds a geogrid scan, so the geogrid kill switch
    // closes it too — before any vendor call.
    if (purpose === 'place-search') assertGeogridEnabled();
    // The setup search keeps its original key; the centre search has its own.
    const cooldownKey = purpose === 'business-search' ? `local-seo-search:${site.id}` : `local-seo-place-search:${site.id}`;
    deps.cooldown?.assert(cooldownKey, LOCAL_BUSINESS_SEARCH_COOLDOWN_MS);

    const market = { locationCode: site.market.locationCode, languageCode: site.market.languageCode };
    deps.cooldown?.touch(cooldownKey);
    let found: LocalBusinessCandidate[];
    let costMicros: bigint | null;
    try {
        const captured = await captureVendorCost(() =>
            deps.provider.searchBusinesses({ query: input.query, ...market }),
        );
        found = captured.value;
        costMicros = captured.costMicros;
    } catch (err) {
        if (err instanceof ProviderError) {
            throw new HttpError(503, { code: 'LOCAL_SEO_ERRORS_UNAVAILABLE', messageKey: 'localSeo.errors.unavailable' }, undefined, { cause: err });
        }
        throw err;
    }

    await createVendorArchiver(createVendorCacheRepo(deps.db))({
        capability: 'local-listings',
        operation: 'business-search',
        params: { query: input.query, ...market },
        payload: { candidates: found },
        accountId: input.accountId,
        costMicros,
        fetchedAt: now,
    });

    const candidates = found
        .map(toStoredCandidate)
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .slice(0, BUSINESS_CANDIDATE_MAX);
    return { now, site, market, candidates };
}

/** One vendor lookup. Stores the candidates so the owner picks from vendor results. */
export async function searchLocalBusinesses(
    input: { accountId: string; siteId: string; query: string },
    deps: LocalBusinessDeps,
): Promise<LocalBusinessSetupView> {
    const { now, site, market, candidates } = await runBusinessSearch(input, deps, 'business-search');
    const profile = await LocalBusinessProfile.findOneAndUpdate(
        { accountId: input.accountId, siteId: site.id },
        {
            $set: {
                candidates,
                candidatesQuery: input.query,
                candidatesLocationCode: market.locationCode,
                candidatesLanguageCode: market.languageCode,
                candidatesExpireAt: new Date(now.getTime() + BUSINESS_CANDIDATE_TTL_MS),
            },
            $setOnInsert: { accountId: input.accountId, siteId: site.id },
        },
        { upsert: true, new: true, lean: true },
    );
    return setupView(profile, now);
}

export type LocalPlaceView = Omit<LocalBusinessCandidateView, 'candidateId' | 'latitude' | 'longitude'> & {
    latitude: number;
    longitude: number;
};

/**
  * Find a place by name or address to centre a geogrid on.
  * Same vendor lookup as business setup, but
  * nothing is stored: the chosen place only fills the grid's centre, and the
  * site's Local SEO business and its search results stay as they were. Only
  * places with a usable coordinate pair are returned.
  */
export async function searchLocalPlaces(
    input: { accountId: string; siteId: string; query: string },
    deps: LocalBusinessDeps,
): Promise<{ query: string; places: LocalPlaceView[] }> {
    const { candidates } = await runBusinessSearch(input, deps, 'place-search');
    const places: LocalPlaceView[] = [];
    for (const candidate of candidates) {
        if (candidate.latitude === null || candidate.longitude === null) continue;
        places.push({
            placeId: candidate.placeId,
            cid: candidate.cid,
            name: candidate.name,
            address: candidate.address,
            phone: candidate.phone,
            domain: candidate.domain,
            category: candidate.category,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
        });
    }
    return { query: input.query, places };
}

/**
  * Save one candidate from the latest search as the site's business. An
  * unknown or expired candidate is a 409 and the previous selection stays.
  * No vendor call.
  */
export async function selectLocalBusiness(
    input: { accountId: string; siteId: string; candidateId: string },
    deps: { now?: () => Date },
): Promise<LocalBusinessSetupView> {
    const now = (deps.now ?? (() => new Date()))();
    const site = await loadOwnedSite(input);
    const profile = await findProfile(input.accountId, site.id);
    const fresh = Boolean(profile?.candidatesExpireAt && profile.candidatesExpireAt > now);
    const candidate = fresh ? profile!.candidates.find((c) => c.candidateId === input.candidateId) : undefined;
    if (!candidate) {
        throw HttpError.conflict({ code: 'LOCAL_SEO_ERRORS_SELECTION_STALE', messageKey: 'localSeo.errors.selectionStale' });
    }

    const updated = await LocalBusinessProfile.findOneAndUpdate(
        { accountId: input.accountId, siteId: site.id },
        {
            $set: {
                selected: {
                    ...businessView(candidate),
                    // Written with every search, so a fresh candidate always has them.
                    locationCode: profile!.candidatesLocationCode!,
                    languageCode: profile!.candidatesLanguageCode!,
                    selectedAt: now,
                },
            },
        },
        { new: true, lean: true },
    );
    return setupView(updated, now);
}

/** Forget the site's business. Snapshots already stored stay readable. */
export async function clearLocalBusiness(
    input: { accountId: string; siteId: string },
    deps: { now?: () => Date },
): Promise<LocalBusinessSetupView> {
    const now = (deps.now ?? (() => new Date()))();
    const site = await loadOwnedSite(input);
    const updated = await LocalBusinessProfile.findOneAndUpdate(
        { accountId: input.accountId, siteId: site.id },
        { $set: { selected: null } },
        { new: true, lean: true },
    );
    return setupView(updated, now);
}
