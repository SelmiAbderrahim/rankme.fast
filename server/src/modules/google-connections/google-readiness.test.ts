import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { Site } from '../sites/sites.model.js';
import { deriveSiteGoogleReadiness, getSiteGoogleReadiness, readSitesGoogleReadiness, withGoogleReadiness } from './google-readiness.js';
import { SCOPE_GA4, SCOPE_GSC } from './google-connections.schema.js';

const site = { url: 'https://example.com/', googleAutoMatch: { gscStatus: 'unbound', ga4Status: 'unbound' } };
const connection = { status: 'connected', scopes: [SCOPE_GSC, SCOPE_GA4] };

describe('site Google readiness', () => {
    it('distinguishes a missing credential from a missing property', () => {
        expect(deriveSiteGoogleReadiness(site, null)).toEqual({
            gsc: { status: 'not_connected', matching: false },
            ga4: { status: 'not_connected', matching: false },
        });
        expect(deriveSiteGoogleReadiness(site, connection)).toEqual({
            gsc: { status: 'no_property', matching: false },
            ga4: { status: 'no_property', matching: false },
        });
    });

    it('reports mismatched bindings and discovery progress from stored evidence', () => {
        expect(deriveSiteGoogleReadiness({
            ...site, gscPropertyUrl: 'https://other.example/', ga4PropertyId: 'properties/1',
            ga4MatchedWebStreamUri: 'https://other.example/',
            googleAutoMatch: { gscStatus: 'matching', ga4Status: 'queued' },
        }, connection)).toEqual({
            gsc: { status: 'property_mismatch', matching: true },
            ga4: { status: 'property_mismatch', matching: true },
        });
    });

    it('accepts a covered GSC property and a manually chosen GA4 property', () => {
        expect(deriveSiteGoogleReadiness({ ...site, gscPropertyUrl: 'sc-domain:example.com', ga4PropertyId: 'properties/1' }, connection)).toEqual({
            gsc: { status: 'ok', matching: false },
            ga4: { status: 'ok', matching: false },
        });
    });

    it('distinguishes missing scopes, reconnects, and discovery errors', () => {
        expect(deriveSiteGoogleReadiness({ ...site, googleAutoMatch: {
            gscStatus: 'needs_reconnect', ga4Status: 'unavailable',
        } }, { status: 'connected', scopes: [SCOPE_GSC] })).toEqual({
            gsc: { status: 'not_connected', matching: false },
            ga4: { status: 'error', matching: false },
        });
        expect(deriveSiteGoogleReadiness({ ...site, gscPropertyUrl: 'sc-domain:example.com',
            ga4PropertyId: 'properties/1' }, { status: 'connected', scopes: [] })).toEqual({
            gsc: { status: 'error', matching: false },
            ga4: { status: 'error', matching: false },
        });
    });

    it('treats a malformed matched stream URL as a property mismatch', () => {
        expect(deriveSiteGoogleReadiness({ ...site, ga4PropertyId: 'properties/1',
            ga4MatchedWebStreamUri: 'not a URL' }, connection).ga4).toEqual({
            status: 'property_mismatch', matching: false,
        });
    });
});

describe('stored site Google readiness', () => {
    beforeAll(startMemoryMongo);
    afterAll(stopMemoryMongo);
    beforeEach(clearCollections);

    it('returns an empty map without querying a connection for an empty site page', async () => {
        expect(await readSitesGoogleReadiness(new Types.ObjectId().toString(), [])).toEqual(new Map());
    });

    it('reads owned sites and supplies an unavailable fallback for absent ids', async () => {
        const accountId = new Types.ObjectId();
        const other = new Types.ObjectId();
        const mine = await Site.create({ accountId, url: 'https://mine.example.com/', domain: 'mine.example.com' });
        const foreign = await Site.create({ accountId: other, url: 'https://other.example.com/', domain: 'other.example.com' });
        const ids = [String(mine._id), String(foreign._id)];
        const readiness = await readSitesGoogleReadiness(String(accountId), ids);
        expect([...readiness.keys()]).toEqual([String(mine._id)]);
        expect(await getSiteGoogleReadiness(String(accountId), String(mine._id)))
            .toEqual({ gsc: { status: 'not_connected', matching: false }, ga4: { status: 'not_connected', matching: false } });
        expect(await withGoogleReadiness(String(accountId), ids.map((id) => ({ id }))))
            .toEqual(ids.map((id) => ({ id, google: {
                gsc: { status: 'not_connected', matching: false }, ga4: { status: 'not_connected', matching: false },
            } })));
        await expect(getSiteGoogleReadiness(String(accountId), String(foreign._id))).rejects.toMatchObject({ status: 404 });
        await expect(getSiteGoogleReadiness(String(accountId), 'invalid')).rejects.toMatchObject({ status: 404 });
    });
});
